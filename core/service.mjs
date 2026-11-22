/** Operations shared by the CLI and MCP surfaces. */

import fs from "node:fs";
import path from "node:path";
import { getAdapter, listAdapters } from "./registry.mjs";
import {
  commitFiles,
  listConversations,
  readConversation,
  recover,
  resolveProject,
  saveConversation,
} from "./store.mjs";
import { renderMarkdown } from "./render/markdown.mjs";
import { renderJson } from "./render/json.mjs";
import { renderHtml } from "./render/html.mjs";
import { verifyAll, verifyConversation } from "./verify.mjs";
import { searchProject } from "./query.mjs";
import { migrateAll, migrateConversation } from "./migrate.mjs";
import { sqliteCapability } from "./ingest/sqlite.mjs";
import { crc32 } from "./ingest/zip.mjs";

export function cataloguePath() {
  return new URL("../catalogue/harnesses.json", import.meta.url);
}

export function readCatalogue() {
  return JSON.parse(fs.readFileSync(cataloguePath(), "utf8"));
}

export function writeIndex(project, options = {}) {
  const resolved = resolveProject(project);
  const conversations = listConversations(resolved.root).filter((entry) => entry.status === "ok");
  const now = options.now ?? new Date().toISOString();
  const lines = [
    "# Conversation exports",
    "",
    `Generated: ${now}`,
    "",
    "| ID | Title | Revision | Source | Source coverage | Selection | Export | Records |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of conversations) {
    const coverage = entry.coverage ?? {};
    lines.push(
      `| ${entry.id} | ${String(entry.title).replace(/\|/g, "\\|")} | ${entry.revision} | ${entry.source?.adapter ?? "unknown"} | ${coverage.source?.status ?? "UNKNOWN"} | ${coverage.selection?.status ?? "UNKNOWN"} | ${coverage.export?.status ?? "UNKNOWN"} | ${entry.counts?.total ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("Coverage is relative to each conversation's stated source boundary.");
  lines.push("");
  const content = lines.join("\n");
  const result = commitFiles(
    resolved.exportRoot,
    [{ target: path.join(resolved.exportRoot, "index.md"), content }],
    { now },
  );
  return { path: path.join(resolved.exportRoot, "index.md"), conversations: conversations.length, transaction: result.transaction };
}

export async function importConversation(options) {
  if (!options.adapter) throw new Error("--adapter is required");
  if (!options.input) throw new Error("--input is required");
  const adapter = getAdapter(options.adapter);
  if (!adapter) throw new Error(`unknown adapter: ${options.adapter}`);
  const view = await adapter.capture({
    input: options.input,
    options: {
      conversationId: options.id,
      title: options.title,
      sourceRef: options.sourceRef,
      complete: options.complete,
      activeBranch: options.activeBranch,
    },
  });
  const now = options.now ?? new Date().toISOString();
  const rendered = {
    "export.md": renderMarkdown(view, { generatedAt: now }),
    "export.json": renderJson(view),
    "export.html": renderHtml(view, { generatedAt: now }),
  };
  const saved = saveConversation(options.project ?? process.cwd(), view, {
    conversationId: view.conversation.id,
    title: options.title,
    now,
    mode: options.update ? "update" : "create",
    rendered,
  });
  const index = writeIndex(options.project ?? process.cwd(), { now });
  return {
    conversation_id: saved.conversationId,
    revision: saved.revision,
    records: view.records.length,
    coverage: saved.metadata.coverage,
    source: saved.metadata.source,
    index: index.path,
    transaction: saved.transaction,
  };
}

export function renderExport(project, id, format = "md") {
  const conversation = readConversation(project, id);
  const generatedAt = conversation.metadata.export?.generated_at;
  if (format === "json") {
    return { format, filename: `${id}.json`, content: renderJson(conversation.view) };
  }
  if (format === "html") {
    return { format, filename: `${id}.html`, content: renderHtml(conversation.view, { generatedAt }) };
  }
  if (format !== "md" && format !== "markdown") throw new Error(`unsupported format: ${format}`);
  return {
    format: "md",
    filename: `${id}.md`,
    content: renderMarkdown(conversation.view, {
      generatedAt,
      rawSha256: conversation.metadata.export?.raw_sha256,
      viewSha256: conversation.metadata.export?.view_sha256,
    }),
  };
}

export function discoverSources(root) {
  const base = path.resolve(root);
  const found = [];
  const walk = (directory, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".export") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target, depth + 1);
        continue;
      }
      const relative = path.relative(base, target).replace(/\\/g, "/");
      let adapter = null;
      if (/\.claude\/projects\/.*\.jsonl$/i.test(relative)) adapter = "claude-code";
      else if (/\.codex\/sessions\/.*\.jsonl$/i.test(relative)) adapter = "codex";
      else if (/\.gemini\/tmp\/.*\/chats\/.*\.jsonl$/i.test(relative)) adapter = "gemini-cli";
      else if (/chatgpt.*\.zip$/i.test(entry.name)) adapter = "chatgpt-export";
      if (!adapter) continue;
      found.push({
        adapter,
        path: target,
        bytes: fs.statSync(target).size,
      });
    }
  };
  walk(base, 0);
  found.sort((left, right) => left.path.localeCompare(right.path));
  return { root: base, sources: found };
}

export async function doctorChecks() {
  const checks = [];
  const add = async (name, fn, required = true) => {
    try {
      const detail = await fn();
      checks.push({ name, status: "PASS", detail });
    } catch (error) {
      checks.push({ name, status: required ? "FAIL" : "WARN", error: error.message });
    }
  };
  await add("runtime", () => {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 20) throw new Error(`Node ${process.version} is too old`);
    return process.version;
  });
  await add("core-modules", async () => {
    const modules = ["./canonical.mjs", "./coverage.mjs", "./store.mjs", "./verify.mjs", "./query.mjs", "./reconstruct.mjs"];
    for (const module of modules) await import(new URL(module, import.meta.url));
    return modules.length;
  });
  await add("adapters", () => {
    const adapters = listAdapters();
    if (adapters.length < 8) throw new Error(`only ${adapters.length} adapters registered`);
    return adapters.length;
  });
  await add("catalogue", () => {
    const catalogue = readCatalogue();
    if (!Array.isArray(catalogue.harnesses) || catalogue.harnesses.length < 8) {
      throw new Error("catalogue is incomplete");
    }
    return catalogue.harnesses.length;
  });
  await add("zip-crc", () => {
    const value = crc32(Buffer.from("123456789"));
    if (value !== 0xcbf43926) throw new Error("CRC-32 self-test failed");
    return "0xcbf43926";
  });
  await add(
    "sqlite",
    async () => {
      const capability = await sqliteCapability();
      if (!capability.available) {
        const error = new Error(capability.reason);
        error.optional = true;
        throw error;
      }
      return capability.node;
    },
    false,
  );
  await add(
    "project",
    () => {
      const resolved = resolveProject(process.cwd());
      return path.relative(resolved.root, resolved.exportRoot) || resolved.exportRoot;
    },
    false,
  );
  const ok = checks.every((check) => check.status !== "FAIL");
  return { ok, checks };
}

export function verify(project, id = null) {
  return id ? verifyConversation(project, id) : verifyAll(project);
}

export function migrate(project, options = {}) {
  return options.all || !options.id
    ? migrateAll(project, { now: options.now })
    : { migrated: [migrateConversation(project, { conversationId: options.id, now: options.now })], skipped: [] };
}

export function recoverStore(project) {
  const report = recover(project);
  const index = writeIndex(project);
  return { ...report, index: index.path };
}

export function search(project, options) {
  return searchProject(project, options);
}
