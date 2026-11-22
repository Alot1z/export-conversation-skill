import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { migrateConversation, rollbackMigration } from "../core/migrate.mjs";
import { readConversation } from "../core/store.mjs";
import { verifyConversation } from "../core/verify.mjs";
import { project } from "./helpers/harness.mjs";

const ID = "conv-legacy-2026-01-01";

function writeLegacy(root) {
  const dir = path.join(root, ".export", "conversations", ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "metadata.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        project: { id: "proj-legacy", name: "legacy" },
        conversation: {
          id: ID,
          title: "Legacy conversation",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T01:00:00.000Z",
          coverage: "complete (T1-T2; T1 reconstructed from handoffs)",
          tags: ["legacy"],
        },
        export: {
          file: "export.md",
          revision: 3,
          generator: "export-conversation 2.2.1",
          sha256: "ignored",
        },
        scope: { mode: "focused", excluded: "unrelated project turns" },
        destination: { project_root_hint: "legacy" },
      },
      null,
      2,
    )}\n`,
  );
  const exportText = `---
export_id: legacy
generator: export-conversation 2.2.1
---

# Legacy conversation

## Summary

A legacy export.

<!-- export:message:1 -->
### 1 User

hello legacy

<!-- export:message:2 -->
### 2 Assistant

legacy answer

## Notes

Preserved manual notes.
`;
  fs.writeFileSync(path.join(dir, "export.md"), exportText);
  return { dir, exportText };
}

test("migration preserves identity, marks content reconstructed and verifies", (t) => {
  const root = project(t, "migration");
  const { dir, exportText } = writeLegacy(root);
  const result = migrateConversation(root, { conversationId: ID, now: "2026-11-22T00:00:00.000Z" });
  assert.equal(result.migrated, true);
  assert.equal(result.messages, 2);
  assert.equal(result.provenance, "RECONSTRUCTED");

  const conversation = readConversation(root, ID);
  assert.equal(conversation.metadata.schema_version, 2);
  assert.equal(conversation.metadata.conversation.id, ID);
  assert.equal(conversation.metadata.conversation.title, "Legacy conversation");
  assert.equal(conversation.metadata.source.adapter, "legacy-2.2.1");
  assert.equal(conversation.metadata.coverage.source.status, "UNKNOWN");
  assert.equal(conversation.metadata.coverage.selection.status, "COMPLETE");
  assert.equal(conversation.metadata.coverage.export.status, "COMPLETE");
  assert.ok(conversation.view.records.every((record) => record.provenance === "RECONSTRUCTED"));
  assert.match(conversation.metadata.migration.original_coverage, /reconstructed/);
  assert.ok(fs.existsSync(path.join(dir, "legacy", "export.md")));
  assert.equal(fs.readFileSync(path.join(dir, "legacy", "export.md"), "utf8"), exportText);
  assert.ok(fs.existsSync(path.join(root, ".export", conversation.metadata.migration.backup, "backup-manifest.json")));
  const report = verifyConversation(root, ID);
  assert.equal(report.ok, true, report.failed.join(","));
});

test("migration is idempotent", (t) => {
  const root = project(t, "migration-idempotent");
  writeLegacy(root);
  migrateConversation(root, { conversationId: ID, now: "2026-11-22T00:00:00.000Z" });
  const second = migrateConversation(root, { conversationId: ID, now: "2026-11-22T00:00:01.000Z" });
  assert.equal(second.skipped, true);
  assert.equal(second.migrated, false);
});

test("rollback restores the schema-1 directory and a re-migration is byte-stable", (t) => {
  const root = project(t, "migration-rollback");
  const { dir, exportText } = writeLegacy(root);
  const first = migrateConversation(root, { conversationId: ID, now: "2026-11-22T00:00:00.000Z" });
  const firstHashes = readConversation(root, ID).view.records.map((record) => record.hash);

  const rolled = rollbackMigration(root, ID);
  assert.equal(rolled.rolledBack, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8")).schema_version, 1);
  assert.equal(fs.readFileSync(path.join(dir, "export.md"), "utf8"), exportText);

  const second = migrateConversation(root, { conversationId: ID, now: "2026-11-22T00:00:02.000Z" });
  assert.equal(second.migrated, true);
  const secondHashes = readConversation(root, ID).view.records.map((record) => record.hash);
  assert.deepEqual(secondHashes, firstHashes);
  assert.equal(first.revision, second.revision);
  assert.equal(verifyConversation(root, ID).ok, true);
});
