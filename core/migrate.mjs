/**
 * Migrate schema-1 (2.2.x) exports without losing identity or content.
 *
 * Legacy exports are reconstructed artifacts, not raw transcripts. Migration
 * marks every imported message RECONSTRUCTED and records the old free-text
 * coverage claim separately instead of promoting it to a verified status.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { buildView, sha256 } from "./canonical.mjs";
import { resolveProject, saveConversation, sanitizeConversationId } from "./store.mjs";
import { renderMarkdown } from "./render/markdown.mjs";
import { renderJson } from "./render/json.mjs";
import { renderHtml } from "./render/html.mjs";

export const MIGRATION_VERSION = 1;

export function parseLegacyMessages(text) {
  const marker = /<!--\s*export:message:(\d+)\s*-->/g;
  const matches = [...text.matchAll(marker)];
  const messages = [];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const segment = text.slice(start, end);
    const heading = /^\s*###\s+(\d+)\s+([A-Za-z]+)\s*$/m.exec(segment);
    const contentStart = heading ? heading.index + heading[0].length : 0;
    let content = segment.slice(contentStart);
    const nextSection = /\n##\s+/.exec(content);
    if (nextSection) content = content.slice(0, nextSection.index);
    content = content.replace(/\n---\s*$/, "").trim();
    messages.push({
      number: Number(match[1]),
      role: (heading?.[2] ?? "unknown").toLowerCase(),
      content,
      marker: match[0],
    });
  });
  return messages;
}

function parseFrontMatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const meta = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) meta[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return meta;
}

function backupConversation(resolved, dir, conversationId, now) {
  const backupsRoot = path.join(resolved.exportRoot, "backups");
  const stamp = now.replace(/[:.]/g, "-");
  let backupDir = path.join(backupsRoot, `${conversationId}-pre-migration-${stamp}`);
  while (fs.existsSync(backupDir)) {
    backupDir = `${backupDir}-${randomBytes(2).toString("hex")}`;
  }
  fs.mkdirSync(backupsRoot, { recursive: true });
  fs.cpSync(dir, backupDir, { recursive: true });
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else {
        files.push({
          path: path.relative(backupDir, target),
          sha256: sha256(fs.readFileSync(target)),
        });
      }
    }
  };
  walk(backupDir);
  const manifest = {
    schema_version: 1,
    conversation_id: conversationId,
    created_at: now,
    source: path.relative(resolved.exportRoot, dir),
    files,
  };
  fs.writeFileSync(
    path.join(backupDir, "backup-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { backupDir, manifest };
}

export function rollbackMigration(projectRoot, conversationId) {
  const resolved = resolveProject(projectRoot);
  const id = sanitizeConversationId(conversationId);
  const backupsRoot = path.join(resolved.exportRoot, "backups");
  if (!fs.existsSync(backupsRoot)) throw new Error(`no migration backups for ${id}`);
  const candidates = fs
    .readdirSync(backupsRoot)
    .filter((name) => name.startsWith(`${id}-pre-migration-`))
    .sort();
  if (candidates.length === 0) throw new Error(`no migration backups for ${id}`);
  const backupDir = path.join(backupsRoot, candidates.at(-1));
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "backup-manifest.json"), "utf8"));
  for (const file of manifest.files) {
    const target = path.join(backupDir, file.path);
    if (sha256(fs.readFileSync(target)) !== file.sha256) {
      throw new Error(`backup file failed verification: ${file.path}`);
    }
  }
  const target = path.join(resolved.conversationsRoot, id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(backupDir, target, { recursive: true });
  fs.rmSync(path.join(target, "backup-manifest.json"), { force: true });
  return { rolledBack: true, id, from: path.basename(backupDir) };
}

export function migrateConversation(projectRoot, options = {}) {
  const resolved = resolveProject(projectRoot);
  const conversationId = sanitizeConversationId(options.conversationId ?? options.id);
  const dir = path.join(resolved.conversationsRoot, conversationId);
  const metadataPath = path.join(dir, "metadata.json");
  if (!fs.existsSync(metadataPath)) throw new Error(`conversation not found: ${conversationId}`);
  const legacyMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (legacyMetadata.schema_version === 2) {
    return { migrated: false, skipped: true, id: conversationId, reason: "already schema 2" };
  }
  if (legacyMetadata.schema_version !== 1) {
    throw new Error(`unsupported schema version: ${legacyMetadata.schema_version}`);
  }
  const exportPath = path.join(dir, legacyMetadata.export?.file ?? "export.md");
  if (!fs.existsSync(exportPath)) throw new Error(`legacy export is missing: ${exportPath}`);
  const legacyText = fs.readFileSync(exportPath, "utf8");
  const messages = parseLegacyMessages(legacyText);
  if (messages.length === 0) throw new Error("legacy export contains no message markers");
  const frontMatter = parseFrontMatter(legacyText);
  const now = options.now ?? new Date().toISOString();

  const { backupDir, manifest } = backupConversation(resolved, dir, conversationId, now);

  try {
    const records = messages.map((message, index) => ({
      seq: index,
      role: message.role,
      type: message.role === "unknown" ? "unknown" : "message",
      content: message.content,
      timestamp: null,
      provenance: "RECONSTRUCTED",
      sourceRef: `legacy:message:${message.number}`,
      status: "legacy-import",
      unknown: message.role === "unknown",
      raw: {
        marker: message.marker,
        heading: `### ${message.number} ${message.role}`,
        legacy_number: message.number,
      },
    }));

    const scope = legacyMetadata.scope ?? {};
    const excluded = Boolean(scope.excluded);
    const boundary = {
      kind: "legacy-2.2.1-export",
      total_known: false,
      total_records: null,
      records_available: records.length,
      records_unavailable: 0,
      history_complete: false,
    };
    const input = {
      conversation: {
        id: conversationId,
        title: legacyMetadata.conversation?.title ?? "Legacy conversation",
        created_at: legacyMetadata.conversation?.created_at ?? now,
        tags: legacyMetadata.conversation?.tags ?? [],
        legacy_coverage: legacyMetadata.conversation?.coverage ?? null,
        legacy_scope: scope,
      },
      source: {
        adapter: "legacy-2.2.1",
        version: legacyMetadata.export?.generator ?? "2.2.1",
        harness: legacyMetadata.project?.name ?? "unknown",
        kind: "official-export",
        ref: path.relative(resolved.exportRoot, exportPath),
        capabilities: {
          user: true,
          assistant: true,
          system: false,
          toolCalls: false,
          toolResults: false,
          attachments: false,
          timestamps: false,
          originalIds: false,
          pagination: false,
          fullHistory: false,
        },
        evidence: "legacy-export",
      },
      boundary,
      records,
      events: [],
      attachments: [],
      warnings: [
        "Legacy 2.2.x export: messages are reconstructed from rendered Markdown; raw upstream records were never captured.",
        "The legacy free-text coverage claim is preserved as metadata and is not treated as verified coverage.",
      ],
    };

    const view = buildView(input);
    const generatedAt = now;
    const rendered = {
      "export.md": renderMarkdown(view, { generatedAt }),
      "export.json": renderJson(view),
      "export.html": renderHtml(view, { generatedAt }),
      [`legacy/${path.basename(exportPath)}`]: legacyText,
    };

    const saved = saveConversation(resolved.root, view, {
      conversationId,
      now,
      revision: 1,
      mode: "update",
      boundary,
      rendered,
      migration: {
        from_version: 1,
        to_version: 2,
        at: now,
        legacy_path: `legacy/${path.basename(exportPath)}`,
        legacy_revision: legacyMetadata.export?.revision ?? null,
        legacy_generator: legacyMetadata.export?.generator ?? null,
        original_coverage: legacyMetadata.conversation?.coverage ?? null,
        backup: path.relative(resolved.exportRoot, backupDir),
        backup_files: manifest.files.length,
        front_matter: frontMatter,
        notes: "All legacy messages are RECONSTRUCTED; no raw upstream transcript was recovered.",
      },
      legacy: {
        schema_version: 1,
        scope,
        destination: legacyMetadata.destination ?? null,
        project: legacyMetadata.project ?? null,
      },
    });

    return {
      migrated: true,
      id: conversationId,
      revision: saved.revision,
      messages: records.length,
      provenance: "RECONSTRUCTED",
      coverage: saved.metadata.coverage,
      backup: path.relative(resolved.exportRoot, backupDir),
    };
  } catch (error) {
    const target = path.join(resolved.conversationsRoot, conversationId);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(backupDir, target, { recursive: true });
    throw error;
  }
}

export function migrateAll(projectRoot, options = {}) {
  const resolved = resolveProject(projectRoot);
  if (!fs.existsSync(resolved.conversationsRoot)) return { migrated: [], skipped: [] };
  const migrated = [];
  const skipped = [];
  for (const name of fs.readdirSync(resolved.conversationsRoot).sort()) {
    const dir = path.join(resolved.conversationsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const metadataPath = path.join(dir, "metadata.json");
    if (!fs.existsSync(metadataPath)) continue;
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch {
      skipped.push({ id: name, reason: "metadata is not valid JSON" });
      continue;
    }
    if (metadata.schema_version !== 1) {
      skipped.push({ id: name, reason: `schema ${metadata.schema_version}` });
      continue;
    }
    migrated.push(migrateConversation(projectRoot, { ...options, conversationId: name }));
  }
  return { migrated, skipped };
}
