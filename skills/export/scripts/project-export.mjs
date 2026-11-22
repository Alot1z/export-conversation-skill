#!/usr/bin/env node
/**
 * Project-scoped conversation exports under <project>/.export/.
 *
 * Usage:
 *   node project-export.mjs resolve [--destination <dir> | --project <dir>] [--cwd <dir>] [--json]
 *   node project-export.mjs init --destination <project> [--project-name <name>] [--json]
 *   node project-export.mjs add --source <export.md> [--destination <project>]
 *        [--archive] [--update] [--conversation-id <id>] [--title <title>]
 *        [--coverage <text>] [--scope <text>] [--filter <text>]
 *        [--include <text>] [--exclude <text>] [--history-gaps <text>]
 *        [--tags a,b] [--manifest <file>] [--now <iso>] [--dry-run] [--json]
 *   node project-export.mjs filter --source <export.md> --messages 1-3,7
 *        [--out <focused.md>] [--project <name>] [--coverage <text>] [--json]
 *   node project-export.mjs list [--destination <project>] [--json]
 *   node project-export.mjs get --conversation-id <id> [--destination <project>] [--json]
 *   node project-export.mjs archive --conversation-id <id> [--destination <project>] [--json]
 *   node project-export.mjs overview [--destination <project>] [--out <file>] [--json]
 *   node project-export.mjs verify [--destination <project>] [--json]
 *
 * Storage is always <project>/.export. Focused mode writes only
 * conversations/<id>/{export.md,metadata.json[,manifest.json]}. Archive mode
 * additionally writes project.json, index.md and README.md. No generated
 * conversation export is written directly into the project root.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractMessages,
  mergeExports,
  parseFrontMatter,
  serializeFrontMatter,
} from "./merge-export.mjs";

export const VERSION = "2.2.1";

const EXPORT_DIR = ".export";
const PROJECT_FILE = "project.json";
const INDEX_FILE = "index.md";
const README_FILE = "README.md";
const CONVERSATIONS_DIR = "conversations";
const EXPORT_FILE = "export.md";
const METADATA_FILE = "metadata.json";
const MANIFEST_FILE = "manifest.json";
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  ".export",
];
const CONVERSATION_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value, length = 12) {
  return hash(value).slice(0, length);
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertInside(parent, child, label) {
  if (!isInside(parent, child)) {
    throw new Error(`${label} escapes the project root: ${child}`);
  }
}

function nearestExisting(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot find an existing ancestor for ${path}`);
    current = parent;
  }
  return current;
}

function assertSafeAncestor(rootReal, target, label = "destination") {
  const ancestorReal = realpathSync(nearestExisting(target));
  assertInside(rootReal, ancestorReal, label);
}

function asDirectory(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
  if (!statSync(absolute).isDirectory()) throw new Error(`${label} is not a directory: ${absolute}`);
  return realpathSync(absolute);
}

function detectProjectRoot(cwd) {
  const start = resolve(cwd);
  if (!existsSync(start) || !statSync(start).isDirectory()) {
    throw new Error(`--cwd is not a directory: ${start}`);
  }

  try {
    const output = execFileSync("git", ["-C", start, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (output && existsSync(output) && statSync(output).isDirectory()) {
      return { root: realpathSync(output), method: "git-root" };
    }
  } catch {
    // The marker walk below handles repositories without a usable git binary.
  }

  let current = start;
  for (;;) {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      return { root: realpathSync(current), method: "project-marker" };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Cannot identify a project root from the working directory. " +
      "Pass --destination <project-root> or --project <project-root>; refusing to guess.",
  );
}

/**
 * Resolve the project destination. Priority:
 * explicit --destination, explicit --project, detected project from --cwd.
 */
export function resolveProjectDestination(options = {}) {
  let root;
  let method;
  if (options.destination) {
    root = asDirectory(options.destination, "--destination");
    method = "explicit-destination";
  } else if (options.project) {
    root = asDirectory(options.project, "--project");
    method = "explicit-project";
  } else {
    const detected = detectProjectRoot(options.cwd ?? process.cwd());
    root = detected.root;
    method = detected.method;
  }

  if (basename(root).toLowerCase() === EXPORT_DIR) {
    throw new Error("Pass the project root, not its .export directory");
  }

  const exportRoot = join(root, EXPORT_DIR);
  if (existsSync(exportRoot)) {
    if (!statSync(exportRoot).isDirectory()) {
      throw new Error(`${exportRoot} exists but is not a directory`);
    }
    const realExport = realpathSync(exportRoot);
    assertInside(root, realExport, ".export destination");
  } else {
    assertSafeAncestor(root, exportRoot, ".export destination");
  }

  return { root, export_root: exportRoot, method };
}

function resultDestination(resolved) {
  return {
    project_root: resolved.root,
    export_root: resolved.export_root,
    resolution: resolved.method,
  };
}

function ensureExportRoot(resolved) {
  if (existsSync(resolved.export_root)) {
    if (!statSync(resolved.export_root).isDirectory()) {
      throw new Error(`${resolved.export_root} exists but is not a directory`);
    }
  } else {
    mkdirSync(resolved.export_root, { recursive: true });
  }
  assertSafeAncestor(resolved.root, resolved.export_root, ".export destination");

  const conversations = join(resolved.export_root, CONVERSATIONS_DIR);
  if (existsSync(conversations)) {
    if (!statSync(conversations).isDirectory()) {
      throw new Error(`${conversations} exists but is not a directory`);
    }
  } else {
    mkdirSync(conversations, { recursive: true });
  }
  assertSafeAncestor(resolved.root, conversations, "conversations directory");
  return conversations;
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content);
  rmSync(path, { force: true });
  renameSync(temporary, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function projectIdFor(root) {
  return `proj-${shortHash(`project:${root}`, 12)}`;
}

function sanitizeId(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 76);
  return normalized;
}

export function conversationIdentity(text, data, provided) {
  let raw;
  let method;
  if (provided && (/[\\/]/.test(provided) || provided.includes(".."))) {
    throw new Error(`Invalid conversation id (path traversal): ${provided}`);
  }
  if (provided) {
    raw = provided;
    method = "provided";
  } else if (data?.export_id) {
    raw = data.export_id;
    method = "front-matter-export-id";
  } else {
    raw = `content-${shortHash(text, 16)}`;
    method = "content-hash";
  }

  let id = sanitizeId(raw);
  if (!id) id = `content-${shortHash(text, 16)}`;
  if (!id.startsWith("conv-")) id = `conv-${id}`;
  if (!CONVERSATION_ID.test(id)) {
    throw new Error(`Invalid conversation id: ${id}`);
  }
  return { id, method };
}

export function validateProjectMetadata(metadata) {
  const errors = [];
  const requireString = (value, path) => {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${path} must be a non-empty string`);
  };

  if (metadata?.schema_version !== 1) errors.push("schema_version must be 1");
  requireString(metadata?.project?.id, "project.id");
  requireString(metadata?.project?.name, "project.name");
  requireString(metadata?.conversation?.id, "conversation.id");
  requireString(metadata?.conversation?.title, "conversation.title");
  requireString(metadata?.conversation?.coverage, "conversation.coverage");
  if (!["active", "archived"].includes(metadata?.conversation?.status)) {
    errors.push("conversation.status must be active or archived");
  }
  requireString(metadata?.conversation?.created_at, "conversation.created_at");
  requireString(metadata?.conversation?.updated_at, "conversation.updated_at");

  if (metadata?.export?.file !== EXPORT_FILE) errors.push(`export.file must be ${EXPORT_FILE}`);
  if (!Number.isInteger(metadata?.export?.revision) || metadata.export.revision < 1) {
    errors.push("export.revision must be a positive integer");
  }
  if (typeof metadata?.export?.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.export.sha256)) {
    errors.push("export.sha256 must be a 64-character lowercase hex digest");
  }
  if (!Number.isInteger(metadata?.export?.bytes) || metadata.export.bytes < 0) {
    errors.push("export.bytes must be a non-negative integer");
  }
  if (!Number.isInteger(metadata?.export?.last_message) || metadata.export.last_message < 1) {
    errors.push("export.last_message must be a positive integer");
  }
  if (!["focused", "archive"].includes(metadata?.scope?.mode)) {
    errors.push("scope.mode must be focused or archive");
  }
  requireString(metadata?.scope?.filter, "scope.filter");
  requireString(metadata?.scope?.included_messages, "scope.included_messages");

  return { ok: errors.length === 0, errors };
}

export function validateProjectFile(project) {
  const errors = [];
  if (project?.schema_version !== 1) errors.push("project schema_version must be 1");
  if (typeof project?.project_id !== "string" || !/^proj-[a-z0-9-]{4,80}$/.test(project.project_id)) {
    errors.push("project_id must be a proj-* identifier");
  }
  if (typeof project?.name !== "string" || project.name.trim() === "") errors.push("name must be a non-empty string");
  if (!Number.isInteger(project?.conversation_count) || project.conversation_count < 0) {
    errors.push("conversation_count must be a non-negative integer");
  }
  if (typeof project?.created_at !== "string" || project.created_at.trim() === "") {
    errors.push("created_at must be a non-empty string");
  }
  if (typeof project?.updated_at !== "string" || project.updated_at.trim() === "") {
    errors.push("updated_at must be a non-empty string");
  }
  return { ok: errors.length === 0, errors };
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function buildIndex(project, conversations) {
  const ordered = [...conversations].sort((left, right) => {
    const created = left.conversation.created_at.localeCompare(right.conversation.created_at);
    return created !== 0 ? created : left.conversation.id.localeCompare(right.conversation.id);
  });
  const rows = ordered.map((metadata) => {
    const conversation = metadata.conversation;
    const exported = metadata.export;
    return [
      `[${escapeCell(conversation.title)}](conversations/${conversation.id}/${exported.file})`,
      escapeCell(conversation.title),
      escapeCell(conversation.created_at),
      escapeCell(conversation.updated_at),
      escapeCell(conversation.coverage),
      exported.revision,
      conversation.status,
    ].join(" | ");
  });

  return [
    `# Project conversation exports — ${project.name}`,
    "",
    "<!-- export:index:start -->",
    "| Export | Subject | Created | Updated | Coverage | Revision | Status |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "<!-- export:index:end -->",
    "",
    "Generated by `project-export.mjs` from `conversations/*/metadata.json`.",
    "",
  ].join("\n");
}

function buildReadme() {
  return [
    "# Conversation exports",
    "",
    "This directory is managed by the `export-conversation` skill.",
    "",
    "- `conversations/<conversation-id>/export.md` is the readable export.",
    "- `conversations/<conversation-id>/metadata.json` is authoritative for identity and scope.",
    "- `conversations/<conversation-id>/manifest.json` records Mermaid render evidence when present.",
    "- `index.md` is generated from conversation metadata; do not edit it by hand.",
    "- `project.json` records project identity and should be kept with the archive.",
    "",
    "Generated conversations are stored here, never directly in the project root.",
    "",
  ].join("\n");
}

function conversationPath(exportRoot, id) {
  if (!CONVERSATION_ID.test(id)) throw new Error(`Invalid conversation id: ${id}`);
  return join(exportRoot, CONVERSATIONS_DIR, id);
}

function metadataPath(exportRoot, id) {
  return join(conversationPath(exportRoot, id), METADATA_FILE);
}

function readConversations(exportRoot) {
  const root = join(exportRoot, CONVERSATIONS_DIR);
  if (!existsSync(root)) return [];
  const conversations = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
    const path = join(root, entry.name, METADATA_FILE);
    if (!existsSync(path)) continue;
    try {
      const metadata = readJson(path);
      conversations.push({ id: entry.name, path: join(root, entry.name), metadata });
    } catch (error) {
      conversations.push({ id: entry.name, path: join(root, entry.name), error: error.message });
    }
  }
  return conversations.sort((left, right) => left.id.localeCompare(right.id));
}

function readProject(exportRoot) {
  const path = join(exportRoot, PROJECT_FILE);
  return existsSync(path) ? readJson(path) : null;
}

function writeArchive(exportRoot, project, conversations, now) {
  project.updated_at = now;
  project.conversation_count = conversations.length;
  writeAtomic(join(exportRoot, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`);
  writeAtomic(join(exportRoot, INDEX_FILE), buildIndex(project, conversations.map((item) => item.metadata)));
  writeAtomic(join(exportRoot, README_FILE), buildReadme());
}

function ensureArchive(resolved, options = {}) {
  const now = options.now ?? new Date().toISOString();
  let project = readProject(resolved.export_root);
  if (!project) {
    project = {
      schema_version: 1,
      project_id: projectIdFor(resolved.root),
      name: (options.projectName || basename(resolved.root)).trim().slice(0, 120),
      created_at: now,
      updated_at: now,
      export_version: VERSION,
      conversation_count: 0,
    };
  } else if (options.projectName) {
    project.name = options.projectName.trim().slice(0, 120);
  }
  const conversations = readConversations(resolved.export_root);
  writeArchive(resolved.export_root, project, conversations, now);
  return project;
}

function projectForMetadata(resolved, options = {}) {
  const existing = readProject(resolved.export_root);
  if (existing) return existing;
  return {
    project_id: projectIdFor(resolved.root),
    name: (options.projectName || basename(resolved.root)).trim().slice(0, 120),
  };
}

function cleanManifest(source, explicitManifest) {
  const path = explicitManifest ? resolve(explicitManifest) : source.replace(/\.md$/i, ".manifest.json");
  if (!existsSync(path)) return null;
  if (!statSync(path).isFile()) throw new Error(`Manifest is not a file: ${path}`);
  let data;
  try {
    data = readJson(path);
  } catch (error) {
    throw new Error(`Cannot parse manifest ${path}: ${error.message}`);
  }
  if (data.ok !== true) throw new Error(`Manifest does not report ok: true: ${path}`);
  return { path, text: `${JSON.stringify(data, null, 2)}\n` };
}

function parseTags(value) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function metadataFor({ resolved, project, id, identity, text, data, messages, options, now, revision, created, status, manifestText, existingMetadata }) {
  const previousConversation = existingMetadata?.conversation;
  const previousScope = existingMetadata?.scope;
  const title = (options.title ?? previousConversation?.title ?? `Conversation ${id}`).trim().slice(0, 160);
  const coverage = options.coverage ?? previousConversation?.coverage ?? data.coverage ?? "unknown";
  const tags = options.tags !== undefined ? parseTags(options.tags) : previousConversation?.tags ?? [];
  return {
    schema_version: 1,
    project: {
      id: project.project_id,
      name: project.name,
    },
    conversation: {
      id,
      title,
      session: data.session || null,
      export_id: data.export_id || null,
      created_at: created,
      updated_at: now,
      coverage,
      tags,
      status: status || "active",
      identity_method: identity.method,
    },
    export: {
      file: EXPORT_FILE,
      revision,
      sha256: hash(text),
      bytes: Buffer.byteLength(text),
      last_message: Math.max(...messages.map((message) => message.index)),
      generator: data.generator || `export-conversation ${VERSION}`,
      manifest: manifestText ? MANIFEST_FILE : null,
    },
    scope: {
      mode: options.archive ? "archive" : previousScope?.mode ?? "focused",
      project: options.scope ?? previousScope?.project ?? project.name,
      filter: options.filter ?? previousScope?.filter ?? "agent-selected",
      included_messages: options.include ?? previousScope?.included_messages ?? "all messages in source",
      excluded: options.exclude ?? previousScope?.excluded ?? "none recorded",
      history_gaps: options.historyGaps ?? previousScope?.history_gaps ?? "none recorded",
    },
    destination: {
      project_root_hint: basename(resolved.root),
    },
  };
}

function commitNewConversation(conversationsRoot, id, text, metadataText, manifestText) {
  const finalDir = join(conversationsRoot, id);
  if (existsSync(finalDir)) throw new Error(`Conversation already exists: ${id}; pass --update`);
  const temporary = join(conversationsRoot, `.tmp-${id}-${process.pid}-${Date.now()}`);
  mkdirSync(temporary, { recursive: true });
  try {
    writeFileSync(join(temporary, EXPORT_FILE), text);
    if (manifestText) writeFileSync(join(temporary, MANIFEST_FILE), manifestText);
    writeFileSync(join(temporary, METADATA_FILE), metadataText);
    renameSync(temporary, finalDir);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function addExport(options) {
  if (!options.source) throw new Error("add requires --source <export.md>");
  const resolved = resolveProjectDestination(options);
  const source = resolve(options.source);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Source export not found: ${source}`);
  const text = readFileSync(source, "utf8");
  const doc = parseFrontMatter(text);
  if (!doc.data) throw new Error("Source export needs YAML front matter");
  const messages = extractMessages(text);
  if (messages.length === 0) throw new Error("Source export needs <!-- export:message:N --> markers");

  const conversationsRoot = ensureExportRoot(resolved);
  const identity = conversationIdentity(text, doc.data, options.conversationId);
  const id = identity.id;
  const existingPath = conversationPath(resolved.export_root, id);
  const existing = existsSync(join(existingPath, METADATA_FILE))
    ? { metadata: readJson(join(existingPath, METADATA_FILE)), text: readFileSync(join(existingPath, EXPORT_FILE), "utf8") }
    : null;

  if (existing && !options.update) {
    throw new Error(`Conversation ${id} already exists; pass --update to merge, or choose another --conversation-id`);
  }
  if (!existing && options.update) {
    throw new Error(`Conversation ${id} does not exist; omit --update to create it`);
  }

  const now = options.now || new Date().toISOString();
  let finalText = text;
  let merged = null;
  if (existing) {
    merged = mergeExports(existing.text, text, { now });
    finalText = merged.text;
  }

  const project = options.archive ? ensureArchive(resolved, { ...options, now }) : projectForMetadata(resolved, options);
  const manifest = cleanManifest(source, options.manifest);
  const existingManifest = existing ? join(existingPath, MANIFEST_FILE) : null;
  const manifestText = manifest?.text ?? (existingManifest && existsSync(existingManifest)
    ? readFileSync(existingManifest, "utf8")
    : null);

  const revision = existing ? existing.metadata.export.revision + 1 : 1;
  const created = existing ? existing.metadata.conversation.created_at : now;
  const status = existing ? existing.metadata.conversation.status : "active";
  const metadata = metadataFor({
    resolved,
    project,
    id,
    identity,
    text: finalText,
    data: parseFrontMatter(finalText).data,
    messages: extractMessages(finalText),
    options,
    now,
    revision,
    created,
    status,
    manifestText,
    existingMetadata: existing?.metadata ?? null,
  });
  const metadataCheck = validateProjectMetadata(metadata);
  if (!metadataCheck.ok) throw new Error(`Generated metadata is invalid: ${metadataCheck.errors.join("; ")}`);

  if (!options.dryRun) {
    if (existing) {
      writeAtomic(join(existingPath, EXPORT_FILE), finalText);
      if (manifestText) writeAtomic(join(existingPath, MANIFEST_FILE), manifestText);
      writeAtomic(join(existingPath, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
    } else {
      commitNewConversation(conversationsRoot, id, finalText, `${JSON.stringify(metadata, null, 2)}\n`, manifestText);
    }

    if (options.archive || readProject(resolved.export_root)) {
      const current = readProject(resolved.export_root) ?? project;
      writeArchive(resolved.export_root, current, readConversations(resolved.export_root), now);
    }
  }

  return {
    ...resultDestination(resolved),
    conversation_id: id,
    identity_method: identity.method,
    mode: options.archive ? "archive" : "focused",
    revision,
    added_messages: merged?.added ?? messages.length,
    preserved_manual_blocks: merged?.preservedManual ?? 0,
    last_message: metadata.export.last_message,
    path: join(conversationPath(resolved.export_root, id), EXPORT_FILE),
    dry_run: Boolean(options.dryRun),
  };
}

function parseSelection(spec, count) {
  if (!spec || spec === "all") return Array.from({ length: count }, (_, index) => index + 1);
  const selected = new Set();
  for (const part of String(spec).split(",")) {
    const value = part.trim();
    if (!value) continue;
    const range = value.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Invalid message selection: ${value}`);
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    if (start < 1 || end < start || end > count) {
      throw new Error(`Message selection ${value} is outside 1-${count}`);
    }
    for (let index = start; index <= end; index += 1) selected.add(index);
  }
  if (selected.size === 0) throw new Error("No messages selected");
  return [...selected].sort((left, right) => left - right);
}

export function filterExportMessages(sourceText, selection, options = {}) {
  const doc = parseFrontMatter(sourceText);
  if (!doc.data) throw new Error("Source export needs YAML front matter");
  const messages = extractMessages(sourceText);
  if (messages.length === 0) throw new Error("Source export needs message markers");
  const selected = parseSelection(selection, messages.length);
  const entries = selected.map((index, position) => {
    const message = messages.find((item) => item.index === index);
    const content = message.entry.replace(/^<!-- export:message:\d+ -->\r?\n/, "").trimEnd();
    return `<!-- export:message:${position + 1} -->\n${content}\n`;
  });

  const region = `<!-- export:messages:start -->\n${entries.join("\n")}\n<!-- export:messages:end -->`;
  const regionPattern = /<!-- export:messages:start -->[\s\S]*?<!-- export:messages:end -->/;
  if (!regionPattern.test(doc.body)) throw new Error("Source export needs message region markers");
  let body = doc.body.replace(regionPattern, region);

  const scope = options.project
    ? `**Scope:** ${options.project}; messages ${selection || "all"} of ${messages.length} selected.\n`
    : `**Scope:** messages ${selection || "all"} of ${messages.length} selected.\n`;
  if (/\*\*Coverage:\*\*[^\n]*\n/.test(body)) {
    body = body.replace(/(\*\*Coverage:\*\*[^\n]*\n)/, `$1${scope}`);
  } else {
    body = body.replace(/## Conversation Summary/, `${scope}\n## Conversation Summary`);
  }

  const data = {
    ...doc.data,
    export_id: `${doc.data.export_id || "export"}-focus-${shortHash(String(selection), 6)}`,
    last_message: String(selected.length),
    coverage: options.coverage || `partial (${selected.length} of ${messages.length} messages selected)`,
    focus_project: options.project || doc.data.focus_project || "",
    selection: String(selection || "all"),
    filtered_from: doc.data.export_id || "",
  };
  return { text: serializeFrontMatter(data, body), selected, sourceMessages: messages.length };
}

function filterCommand(options) {
  if (!options.source) throw new Error("filter requires --source <export.md>");
  const source = resolve(options.source);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Source export not found: ${source}`);
  const result = filterExportMessages(readFileSync(source, "utf8"), options.messages, {
    project: options.projectName || options.project,
    coverage: options.coverage,
  });
  if (options.out) writeAtomic(resolve(options.out), result.text);
  return {
    source,
    out: options.out ? resolve(options.out) : null,
    selected: result.selected,
    source_messages: result.sourceMessages,
    text: options.out ? null : result.text,
  };
}

function initArchive(options) {
  const resolved = resolveProjectDestination(options);
  ensureExportRoot(resolved);
  const now = options.now || new Date().toISOString();
  const project = ensureArchive(resolved, { ...options, now });
  return { ...resultDestination(resolved), project_id: project.project_id, project_name: project.name };
}

function listCommand(options) {
  const resolved = resolveProjectDestination(options);
  if (!existsSync(resolved.export_root)) {
    return { ...resultDestination(resolved), conversations: [], archive: false };
  }
  const conversations = readConversations(resolved.export_root).map((item) => ({
    id: item.id,
    path: join(item.path, EXPORT_FILE),
    metadata: item.metadata,
    error: item.error ?? null,
  }));
  return { ...resultDestination(resolved), archive: Boolean(readProject(resolved.export_root)), conversations };
}

function findConversation(options) {
  if (!options.conversationId) throw new Error("--conversation-id is required");
  if (/[\\/]/.test(options.conversationId) || options.conversationId.includes("..")) {
    throw new Error(`Invalid conversation id (path traversal): ${options.conversationId}`);
  }
  const resolved = resolveProjectDestination(options);
  let id = sanitizeId(options.conversationId);
  if (id && !id.startsWith("conv-")) id = `conv-${id}`;
  if (!id || !CONVERSATION_ID.test(id)) throw new Error(`Invalid conversation id: ${options.conversationId}`);
  const path = conversationPath(resolved.export_root, id);
  const metadataFile = join(path, METADATA_FILE);
  if (!existsSync(metadataFile)) throw new Error(`Conversation not found: ${id}`);
  return {
    resolved,
    id,
    path,
    metadata: readJson(metadataFile),
    export_path: join(path, EXPORT_FILE),
  };
}

function getCommand(options) {
  const found = findConversation(options);
  if (options.json) return { conversation_id: found.id, path: found.export_path, metadata: found.metadata };
  return { path: found.export_path, metadata: found.metadata };
}

function archiveCommand(options) {
  const found = findConversation(options);
  const now = options.now || new Date().toISOString();
  found.metadata.conversation.status = "archived";
  found.metadata.conversation.updated_at = now;
  writeAtomic(join(found.path, METADATA_FILE), `${JSON.stringify(found.metadata, null, 2)}\n`);
  const project = readProject(found.resolved.export_root);
  if (project) writeArchive(found.resolved.export_root, project, readConversations(found.resolved.export_root), now);
  return { conversation_id: found.id, status: "archived", path: found.export_path };
}

function overviewCommand(options) {
  const resolved = resolveProjectDestination(options);
  if (!existsSync(resolved.export_root)) throw new Error(`No .export directory at ${resolved.export_root}`);
  const conversations = readConversations(resolved.export_root);
  const project = readProject(resolved.export_root);
  const name = project?.name || basename(resolved.root);
  const active = conversations.filter((item) => item.metadata?.conversation?.status === "active").length;
  const archived = conversations.filter((item) => item.metadata?.conversation?.status === "archived").length;
  const rows = conversations.map((item) => {
    const metadata = item.metadata;
    return `| ${escapeCell(metadata.conversation.title)} | ${metadata.conversation.status} | ${escapeCell(metadata.conversation.coverage)} | ${metadata.export.revision} | [export](conversations/${item.id}/export.md) |`;
  });
  const text = [
    `# Project overview — ${name}`,
    "",
    `- Project: ${project?.project_id || "focused(no project.json)"}`,
    `- Conversations: ${conversations.length} (${active} active, ${archived} archived)`,
    `- Generated from metadata only; source exports were not modified.`,
    "",
    "| Subject | Status | Coverage | Revision | Export |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");

  let out = null;
  if (options.out) {
    out = isAbsolute(options.out) ? resolve(options.out) : join(resolved.export_root, options.out);
    assertInside(resolved.export_root, out, "overview output");
    assertSafeAncestor(resolved.root, out, "overview output");
    writeAtomic(out, text);
  }
  return { ...resultDestination(resolved), conversations: conversations.length, out, text: out ? null : text };
}

function verifyCommand(options) {
  const resolved = resolveProjectDestination(options);
  const errors = [];
  const warnings = [];
  if (!existsSync(resolved.export_root)) throw new Error(`No .export directory at ${resolved.export_root}`);

  const project = readProject(resolved.export_root);
  if (project) {
    const check = validateProjectFile(project);
    errors.push(...check.errors);
    if (existsSync(join(resolved.export_root, INDEX_FILE))) {
      const actual = readFileSync(join(resolved.export_root, INDEX_FILE), "utf8");
      const expected = buildIndex(project, readConversations(resolved.export_root).map((item) => item.metadata));
      if (actual !== expected) errors.push("index.md does not match the deterministic project index");
    } else {
      errors.push("project.json exists but index.md is missing");
    }
  } else if (existsSync(join(resolved.export_root, INDEX_FILE))) {
    errors.push("index.md exists without project.json");
  }

  const conversations = readConversations(resolved.export_root);
  for (const item of conversations) {
    if (item.error) {
      errors.push(`${item.id}: cannot read metadata: ${item.error}`);
      continue;
    }
    const check = validateProjectMetadata(item.metadata);
    errors.push(...check.errors.map((error) => `${item.id}: ${error}`));
    if (item.metadata.conversation.id !== item.id) {
      errors.push(`${item.id}: metadata conversation.id is ${item.metadata.conversation.id}`);
    }
    if (project && item.metadata.project.id !== project.project_id) {
      errors.push(`${item.id}: project.id does not match project.json`);
    }
    const exportPath = join(item.path, EXPORT_FILE);
    if (!existsSync(exportPath)) {
      errors.push(`${item.id}: export.md is missing`);
      continue;
    }
    const content = readFileSync(exportPath);
    if (hash(content) !== item.metadata.export.sha256) errors.push(`${item.id}: export hash does not match metadata`);
    if (Buffer.byteLength(content) !== item.metadata.export.bytes) errors.push(`${item.id}: export byte count does not match metadata`);
    for (const field of ["manifest"]) {
      const file = item.metadata.export[field];
      if (file && !existsSync(join(item.path, file))) errors.push(`${item.id}: ${file} is missing`);
    }
  }

  if (project && project.conversation_count !== conversations.length) {
    errors.push(`project.json conversation_count is ${project.conversation_count}, found ${conversations.length}`);
  }
  return { ...resultDestination(resolved), ok: errors.length === 0, errors, warnings, conversations: conversations.length };
}

function parseOptions(argv) {
  const options = { help: false };
  const booleans = new Set(["--archive", "--update", "--json", "--dry-run", "--help", "-h"]);
  const values = new Set([
    "--destination",
    "--project",
    "--cwd",
    "--project-name",
    "--source",
    "--conversation-id",
    "--title",
    "--coverage",
    "--scope",
    "--filter",
    "--include",
    "--exclude",
    "--history-gaps",
    "--tags",
    "--manifest",
    "--now",
    "--out",
    "--messages",
  ]);
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equal = arg.startsWith("--") && arg.includes("=");
    const name = equal ? arg.slice(0, arg.indexOf("=")) : arg;
    if (booleans.has(name)) {
      if (name === "--help" || name === "-h") options.help = true;
      else options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
    } else if (values.has(name)) {
      const value = equal ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (value === undefined || value === "") throw new Error(`${name} requires a value`);
      const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

const USAGE = `Usage:
  node project-export.mjs resolve [--destination <dir> | --project <dir>] [--cwd <dir>] [--json]
  node project-export.mjs init --destination <project> [--project-name <name>] [--json]
  node project-export.mjs add --source <export.md> [--destination <project>] [--archive] [--update]
       [--conversation-id <id>] [--title <title>] [--coverage <text>] [--scope <text>]
       [--filter <text>] [--include <text>] [--exclude <text>] [--history-gaps <text>]
       [--tags a,b] [--manifest <file>] [--now <iso>] [--dry-run] [--json]
  node project-export.mjs filter --source <export.md> --messages 1-3,7 [--out <focused.md>] [--json]
  node project-export.mjs list [--destination <project>] [--json]
  node project-export.mjs get --conversation-id <id> [--destination <project>] [--json]
  node project-export.mjs archive --conversation-id <id> [--destination <project>] [--json]
  node project-export.mjs overview [--destination <project>] [--out <file>] [--json]
  node project-export.mjs verify [--destination <project>] [--json]`;

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  let parsed;
  try {
    parsed = parseOptions(rest);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }
  const { options, positionals } = parsed;
  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (!options.source && positionals.length > 0 && ["add", "filter"].includes(command)) {
    options.source = positionals.shift();
  }
  if (!options.conversationId && positionals.length > 0 && ["get", "archive"].includes(command)) {
    options.conversationId = positionals.shift();
  }

  let report;
  try {
    switch (command) {
      case "resolve":
        report = resultDestination(resolveProjectDestination(options));
        break;
      case "init":
        report = initArchive(options);
        break;
      case "add":
        report = addExport(options);
        break;
      case "filter":
        report = filterCommand(options);
        break;
      case "list":
        report = listCommand(options);
        break;
      case "get":
        report = getCommand(options);
        break;
      case "archive":
        report = archiveCommand(options);
        break;
      case "overview":
        report = overviewCommand(options);
        break;
      case "verify":
        report = verifyCommand(options);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    else console.error(error.message);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (command === "filter" && report.text) {
    console.log(report.text);
  } else if (command === "overview" && report.text) {
    console.log(report.text);
  } else if (command === "get") {
    console.log(report.path);
  } else if (command === "list") {
    console.log(`Project: ${report.project_root}`);
    console.log(`Archive: ${report.archive ? "yes" : "focused only"}`);
    for (const item of report.conversations) {
      const meta = item.metadata ?? {};
      console.log(`${item.id}  ${meta.conversation?.status ?? "invalid"}  r${meta.export?.revision ?? "?"}  ${meta.conversation?.title ?? item.error ?? ""}`);
    }
    console.log(`${report.conversations.length} conversation(s)`);
  } else if (command === "verify") {
    console.log(report.ok ? `Project export valid: ${report.conversations} conversation(s)` : "Project export INVALID");
    for (const error of report.errors) console.log(`error: ${error}`);
    for (const warning of report.warnings) console.log(`warning: ${warning}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (command === "verify" && !report.ok) process.exit(1);
}

const self = basename(fileURLToPath(import.meta.url));
if (process.argv[1] && basename(process.argv[1]) === self) {
  main();
}
