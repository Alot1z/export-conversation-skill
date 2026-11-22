/**
 * Filesystem conversation store.
 *
 * Every mutation is a transaction: staged files are hashed, existing targets
 * are backed up, a journal records each stage, then renames commit. A crash at
 * any point leaves a journal that `recover()` can roll back.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { buildView, sha256, validateConversation, SCHEMA_VERSION } from "./canonical.mjs";
import { applyCoverage } from "./coverage.mjs";

export const EXPORT_DIR = ".export";
export const CONVERSATIONS_DIR = "conversations";
export const TRANSACTIONS_DIR = "transactions";
export const LOCK_FILE = "lock.json";

export class StoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.details = details;
  }
}

export function resolveProject(projectRoot) {
  if (!projectRoot) throw new StoreError("PROJECT_REQUIRED", "project root is required");
  const absolute = path.resolve(projectRoot);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new StoreError("PROJECT_NOT_FOUND", `project root does not exist: ${absolute}`);
  }
  if (!stat.isDirectory()) {
    throw new StoreError("PROJECT_NOT_DIRECTORY", `project root is not a directory: ${absolute}`);
  }
  const root = fs.realpathSync(absolute);
  if (path.basename(root) === EXPORT_DIR) {
    throw new StoreError("PROJECT_IS_EXPORT_ROOT", "project root must not be the export directory");
  }
  const exportRoot = path.join(root, EXPORT_DIR);
  const relative = path.relative(root, exportRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new StoreError("PATH_ESCAPE", "export root escapes the project");
  }
  return {
    root,
    exportRoot,
    conversationsRoot: path.join(exportRoot, CONVERSATIONS_DIR),
    transactionsRoot: path.join(exportRoot, TRANSACTIONS_DIR),
  };
}

export function sanitizeConversationId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) || id.includes("..")) {
    throw new StoreError("INVALID_CONVERSATION_ID", `invalid conversation id: ${value}`);
  }
  return id;
}

export function conversationDir(projectRoot, conversationId) {
  const resolved = resolveProject(projectRoot);
  return path.join(resolved.conversationsRoot, sanitizeConversationId(conversationId));
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function lockPath(exportRoot) {
  return path.join(exportRoot, LOCK_FILE);
}

export function acquireLock(exportRoot, options = {}) {
  fs.mkdirSync(exportRoot, { recursive: true });
  const target = lockPath(exportRoot);
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomBytes(12).toString("hex");
  const entry = {
    schema_version: SCHEMA_VERSION,
    pid,
    host: options.host ?? os.hostname(),
    started_at: options.now ?? new Date().toISOString(),
    token,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = fs.openSync(target, "wx");
      fs.writeFileSync(handle, `${JSON.stringify(entry, null, 2)}\n`);
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      return releaseHandle(target, token);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(target, "utf8"));
    } catch {
      if (!options.force) {
        throw new StoreError("LOCK_CORRUPT", "lock file is unreadable; pass --force to replace it");
      }
      fs.rmSync(target, { force: true });
      continue;
    }
    if (current.pid === pid) return releaseHandle(target, token, current.token);
    if (isProcessAlive(current.pid)) {
      throw new StoreError("LOCKED", `conversation store is locked by pid ${current.pid}`, {
        pid: current.pid,
        started_at: current.started_at,
      });
    }
    fs.rmSync(target, { force: true });
  }
  throw new StoreError("LOCKED", "could not acquire the conversation store lock");
}

function releaseHandle(target, token, existingToken = token) {
  return {
    token: existingToken,
    release() {
      let current;
      try {
        current = JSON.parse(fs.readFileSync(target, "utf8"));
      } catch {
        return;
      }
      if (current.token !== existingToken) return;
      fs.rmSync(target, { force: true });
    },
  };
}

export function withLock(projectRoot, fn, options = {}) {
  const resolved = resolveProject(projectRoot);
  const lock = acquireLock(resolved.exportRoot, options);
  try {
    return fn(resolved);
  } finally {
    lock.release();
  }
}

function durableWrite(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const handle = fs.openSync(target, "w");
  try {
    fs.writeFileSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function copyDurable(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  const handle = fs.openSync(target, "r+");
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function transactionName() {
  return `tx-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function hook(options, stage) {
  if (options.failAt === stage) {
    throw new StoreError("INJECTED_FAILURE", `injected failure at stage ${stage}`);
  }
}

function writeJournal(txDir, journal) {
  durableWrite(path.join(txDir, "journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
}

/**
 * Commit a set of absolute target files under the export root.
 * Returns the transaction directory name and the committed entries.
 */
export function commitFiles(exportRoot, files, options = {}) {
  if (!files.length) throw new StoreError("EMPTY_TRANSACTION", "no files to commit");
  const transactionsRoot = path.join(exportRoot, TRANSACTIONS_DIR);
  fs.mkdirSync(transactionsRoot, { recursive: true });
  const txName = options.transactionId ?? transactionName();
  const txDir = path.join(transactionsRoot, txName);
  fs.mkdirSync(path.join(txDir, "staged"), { recursive: true });
  fs.mkdirSync(path.join(txDir, "backup"), { recursive: true });

  const entries = files.map((file, index) => {
    const target = path.resolve(file.target);
    const relative = path.relative(exportRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new StoreError("PATH_ESCAPE", `transaction target escapes the export root: ${target}`);
    }
    if (relative.split(path.sep).includes("transactions")) {
      throw new StoreError("PATH_ESCAPE", "transaction target may not be inside transactions");
    }
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const staged = path.join(txDir, "staged", String(index));
    durableWrite(staged, content);
    return {
      index,
      target,
      relative,
      staged,
      sha256: sha256(content),
      bytes: content.length,
      existed: fs.existsSync(target),
    };
  });

  const journal = {
    schema_version: SCHEMA_VERSION,
    transaction: txName,
    created_at: options.now ?? new Date().toISOString(),
    stage: "staged",
    files: entries.map(({ index, relative, sha256: hash, bytes, existed }) => ({
      index,
      relative,
      sha256: hash,
      bytes,
      existed,
    })),
  };
  writeJournal(txDir, journal);
  hook(options, "staged");

  entries.forEach((entry, index) => {
    if (!entry.existed) return;
    copyDurable(entry.target, path.join(txDir, "backup", String(index)));
    journal.stage = `backed-up:${index}`;
    writeJournal(txDir, journal);
  });
  journal.stage = "backed-up";
  writeJournal(txDir, journal);
  hook(options, "backed-up");

  entries.forEach((entry, index) => {
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    if (entry.existed && fs.existsSync(entry.target)) fs.rmSync(entry.target, { force: true });
    fs.renameSync(entry.staged, entry.target);
    journal.stage = `renamed:${index}`;
    writeJournal(txDir, journal);
    if (options.failAfterRename === index + 1) {
      throw new StoreError("INJECTED_FAILURE", "injected failure after rename");
    }
  });
  journal.stage = "renamed";
  writeJournal(txDir, journal);
  hook(options, "renamed");
  journal.stage = "committed";
  writeJournal(txDir, journal);
  hook(options, "committed");
  fs.rmSync(txDir, { recursive: true, force: true });
  return { transaction: txName, files: entries.map(({ relative, sha256: hash }) => ({ relative, sha256: hash })) };
}

export function recover(projectRoot) {
  const resolved = resolveProject(projectRoot);
  const report = { recovered: [], errors: [], removed: [] };
  const transactionsRoot = resolved.transactionsRoot;
  if (!fs.existsSync(transactionsRoot)) return report;
  for (const name of fs.readdirSync(transactionsRoot)) {
    const txDir = path.join(transactionsRoot, name);
    if (!fs.statSync(txDir).isDirectory()) continue;
    let journal;
    try {
      journal = JSON.parse(fs.readFileSync(path.join(txDir, "journal.json"), "utf8"));
    } catch {
      report.errors.push({ transaction: name, error: "journal is missing or corrupt" });
      continue;
    }
    if (journal.stage === "committed") {
      fs.rmSync(txDir, { recursive: true, force: true });
      report.removed.push(name);
      continue;
    }
    const restored = [];
    for (const entry of [...journal.files].reverse()) {
      const target = path.join(resolved.exportRoot, entry.relative);
      const backup = path.join(txDir, "backup", String(entry.index));
      if (fs.existsSync(backup)) {
        copyDurable(backup, target);
        restored.push(entry.relative);
      } else if (!entry.existed && fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        restored.push(entry.relative);
      }
    }
    fs.rmSync(txDir, { recursive: true, force: true });
    report.recovered.push({ transaction: name, stage: journal.stage, files: restored });
  }
  return report;
}

function readJsonIfExists(target) {
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new StoreError("CORRUPT_JSON", `cannot parse ${target}: ${error.message}`);
  }
}

export function listConversations(projectRoot) {
  const resolved = resolveProject(projectRoot);
  if (!fs.existsSync(resolved.conversationsRoot)) return [];
  const conversations = [];
  for (const name of fs.readdirSync(resolved.conversationsRoot).sort()) {
    const dir = path.join(resolved.conversationsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const metadata = readJsonIfExists(path.join(dir, "metadata.json"));
    if (!metadata) {
      conversations.push({ id: name, status: "invalid", error: "metadata.json is missing" });
      continue;
    }
    conversations.push({
      id: metadata.conversation?.id ?? name,
      title: metadata.conversation?.title ?? "Untitled",
      status: "ok",
      revision: metadata.export?.revision ?? 0,
      coverage: metadata.coverage ?? null,
      counts: metadata.coverage?.counts ?? null,
      source: metadata.source ?? null,
      updated_at: metadata.conversation?.updated_at ?? null,
      path: dir,
    });
  }
  return conversations;
}

export function readRaw(projectRoot, conversationId) {
  const dir = conversationDir(projectRoot, conversationId);
  const target = path.join(dir, "raw", "records.jsonl");
  if (!fs.existsSync(target)) throw new StoreError("NOT_FOUND", `raw records not found for ${conversationId}`);
  return fs
    .readFileSync(target, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { id: `malformed:${index}`, malformed: true, parse_error: error.message, text: line };
      }
    });
}

export function readConversation(projectRoot, conversationId) {
  const dir = conversationDir(projectRoot, conversationId);
  const metadata = readJsonIfExists(path.join(dir, "metadata.json"));
  if (!metadata) throw new StoreError("NOT_FOUND", `conversation not found: ${conversationId}`);
  const viewPath = path.join(dir, "view", "conversation.json");
  const view = readJsonIfExists(viewPath);
  return {
    dir,
    metadata,
    view,
    raw: readRaw(projectRoot, conversationId),
    ledger: readJsonIfExists(path.join(dir, "capture", "ledger.json")),
  };
}

export function saveConversation(projectRoot, input, options = {}) {
  return withLock(
    projectRoot,
    (resolved) => {
      const conversationId = sanitizeConversationId(
        options.conversationId ?? input.conversation?.id,
      );
      const dir = path.join(resolved.conversationsRoot, conversationId);
      const existingMetadata = readJsonIfExists(path.join(dir, "metadata.json"));
      if (existingMetadata && options.mode === "create") {
        throw new StoreError("ALREADY_EXISTS", `conversation already exists: ${conversationId}`);
      }
      if (!existingMetadata && options.mode === "update") {
        throw new StoreError("NOT_FOUND", `conversation does not exist: ${conversationId}`);
      }

      const now = options.now ?? new Date().toISOString();
      const view = buildView(input);
      view.conversation.id = conversationId;
      view.conversation.title = options.title ?? view.conversation.title ?? "Conversation";
      view.conversation.captured_at = view.conversation.captured_at ?? now;
      view.conversation.updated_at = now;
      applyCoverage(view, {
        boundary: options.boundary ?? view.boundary,
        selectedIds: options.selectedIds ?? null,
        renderedCount: options.renderedCount ?? null,
        selectionOverride: options.selectionOverride ?? null,
      });
      const validation = validateConversation(view);
      if (!validation.ok) {
        throw new StoreError("INVALID_VIEW", "canonical view failed validation", {
          errors: validation.errors,
        });
      }

      const rawText = `${view.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
      const rawHash = sha256(rawText);
      const viewText = `${JSON.stringify(view, null, 2)}\n`;
      const viewSha = sha256(viewText);
      const revision = options.revision ?? (existingMetadata?.export?.revision ?? 0) + 1;

      const ledger = {
        schema_version: SCHEMA_VERSION,
        conversation_id: conversationId,
        captured_at: now,
        source: view.source,
        boundary: view.boundary,
        coverage: view.coverage,
        counts: view.coverage.counts,
        raw_sha256: rawHash,
        view_sha256: viewSha,
        records: view.records.map((record) => ({
          id: record.id,
          seq: record.seq,
          hash: record.hash,
          raw_sha256: record.rawHash,
          provenance: record.provenance,
          type: record.type,
          source_ref: record.sourceRef,
          timestamp: record.timestamp,
        })),
        tool_pairs: view.tool_pairs,
        attachments: view.attachments,
        warnings: view.warnings,
      };

      const rendered = options.rendered ?? {};
      const exportHashes = {};
      for (const [name, content] of Object.entries(rendered)) {
        exportHashes[name] = sha256(content);
      }

      const revisionPath = path.join(dir, "revisions", `${revision}.json`);
      const previousRevision = readJsonIfExists(revisionPath.replace(`${revision}.json`, `${revision - 1}.json`));
      const previousSha = previousRevision
        ? sha256(`${JSON.stringify(previousRevision, null, 2)}\n`)
        : null;
      const revisionRecord = {
        schema_version: SCHEMA_VERSION,
        conversation_id: conversationId,
        revision,
        previous_sha256: previousSha,
        raw_sha256: rawHash,
        view_sha256: viewSha,
        exports: exportHashes,
        created_at: now,
      };
      const revisionText = `${JSON.stringify(revisionRecord, null, 2)}\n`;
      const chainSha = sha256(revisionText);

      const metadata = {
        schema_version: SCHEMA_VERSION,
        conversation: {
          id: conversationId,
          title: view.conversation.title,
          created_at: existingMetadata?.conversation?.created_at ?? view.conversation.captured_at,
          updated_at: now,
          active_branch: view.conversation.active_branch,
        },
        source: view.source,
        boundary: view.boundary,
        coverage: view.coverage,
        adapter: view.source?.adapter ?? null,
        export: {
          revision,
          raw_sha256: rawHash,
          view_sha256: viewSha,
          chain_sha256: chainSha,
          record_count: view.records.length,
          exports: exportHashes,
          generated_at: now,
        },
        migration: options.migration ?? existingMetadata?.migration ?? null,
        legacy: options.legacy ?? existingMetadata?.legacy ?? null,
      };
      const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
      const manifest = {
        schema_version: SCHEMA_VERSION,
        conversation_id: conversationId,
        revision,
        generated_at: now,
        files: {
          "raw/records.jsonl": rawHash,
          "view/conversation.json": viewSha,
          "capture/ledger.json": sha256(`${JSON.stringify(ledger, null, 2)}\n`),
          "metadata.json": sha256(metadataText),
          [`revisions/${revision}.json`]: chainSha,
          ...Object.fromEntries(
            Object.keys(rendered).map((name) => [name, exportHashes[name]]),
          ),
        },
      };

      const files = [
        { target: path.join(dir, "raw", "records.jsonl"), content: rawText },
        { target: path.join(dir, "view", "conversation.json"), content: viewText },
        { target: path.join(dir, "capture", "ledger.json"), content: `${JSON.stringify(ledger, null, 2)}\n` },
        { target: path.join(dir, "metadata.json"), content: metadataText },
        { target: path.join(dir, "manifest.json"), content: `${JSON.stringify(manifest, null, 2)}\n` },
        { target: revisionPath, content: revisionText },
      ];
      for (const [name, content] of Object.entries(rendered)) {
        files.push({ target: path.join(dir, name), content });
      }

      const transaction = commitFiles(resolved.exportRoot, files, {
        now,
        failAt: options.failAt,
        failAfterRename: options.failAfterRename,
        transactionId: options.transactionId,
      });
      return {
        conversationId,
        dir,
        revision,
        raw_sha256: rawHash,
        view_sha256: viewSha,
        transaction: transaction.transaction,
        metadata,
      };
    },
    { now: options.now, force: options.force, pid: options.pid },
  );
}
