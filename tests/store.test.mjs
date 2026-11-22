import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  listConversations,
  readConversation,
  readRaw,
  recover,
  saveConversation,
} from "../core/store.mjs";
import { verifyConversation } from "../core/verify.mjs";
import { project, saveSample } from "./helpers/harness.mjs";

test("save, read, list and revision chaining", (t) => {
  const root = project(t, "store-basic");
  const first = saveSample(root);
  assert.equal(first.revision, 1);
  const read = readConversation(root, "sample");
  assert.equal(read.view.records.length, 2);
  assert.equal(read.metadata.coverage.source.status, "COMPLETE");
  assert.deepEqual(
    listConversations(root).map((entry) => `${entry.id}:${entry.revision}`),
    ["sample:1"],
  );
  const second = saveSample(
    root,
    { messages: [{ role: "user", content: "changed" }] },
    { now: "2026-11-22T00:00:01.000Z", save: { mode: "update" } },
  );
  assert.equal(second.revision, 2);
  assert.ok(fs.existsSync(path.join(second.dir, "revisions", "1.json")));
  assert.ok(fs.existsSync(path.join(second.dir, "revisions", "2.json")));
  assert.equal(verifyConversation(root, "sample").ok, true);
});

test("a crash at the staged stage leaves the original untouched", (t) => {
  const root = project(t, "store-staged");
  saveSample(root);
  const before = readConversation(root, "sample").view.records.map((record) => record.content);
  assert.throws(
    () =>
      saveSample(
        root,
        { messages: [{ role: "user", content: "new value" }] },
        { now: "2026-11-22T00:00:02.000Z", save: { mode: "update", failAt: "staged" } },
      ),
    /injected failure/,
  );
  const report = recover(root);
  assert.equal(report.recovered.length, 1);
  assert.deepEqual(
    readConversation(root, "sample").view.records.map((record) => record.content),
    before,
  );
  assert.equal(fs.existsSync(path.join(root, ".export", "transactions")) ? fs.readdirSync(path.join(root, ".export", "transactions")).length : 0, 0);
});

test("a crash after a partial rename is rolled back from the journal", (t) => {
  const root = project(t, "store-rename");
  saveSample(root);
  const before = readConversation(root, "sample").view.records.map((record) => record.content);
  assert.throws(
    () =>
      saveSample(
        root,
        { messages: [{ role: "user", content: "partial" }] },
        { now: "2026-11-22T00:00:03.000Z", save: { mode: "update", failAfterRename: 2 } },
      ),
    /injected failure/,
  );
  assert.ok(fs.existsSync(path.join(root, ".export", "transactions")));
  const report = recover(root);
  assert.ok(report.recovered[0].files.length >= 2);
  assert.deepEqual(
    readConversation(root, "sample").view.records.map((record) => record.content),
    before,
  );
  assert.equal(verifyConversation(root, "sample").ok, true);
});

test("a live writer blocks the store and a dead pid does not", async (t) => {
  const root = project(t, "store-lock");
  saveSample(root);
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "ignore" });
  t.after(() => child.kill());
  await new Promise((resolve) => setTimeout(resolve, 250));
  const lockPath = path.join(root, ".export", "lock.json");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: child.pid, host: "test", started_at: new Date().toISOString(), token: "held" }),
  );
  assert.throws(
    () => saveSample(root, {}, { save: { mode: "update" } }),
    (error) => error.code === "LOCKED",
  );
  fs.rmSync(lockPath, { force: true });
  child.kill();

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 999999, host: "test", started_at: "2000-01-01T00:00:00Z", token: "dead" }),
  );
  const saved = saveSample(root, {}, { save: { mode: "update" } });
  assert.ok(saved.revision >= 2);
  assert.equal(fs.existsSync(lockPath), false);
});

test("raw and revision tampering are detected independently", (t) => {
  const root = project(t, "store-tamper");
  const saved = saveSample(root);
  const rawPath = path.join(saved.dir, "raw", "records.jsonl");
  fs.appendFileSync(rawPath, `${JSON.stringify({ id: "injected" })}\n`);
  const rawReport = verifyConversation(root, "sample");
  assert.ok(rawReport.failed.includes("raw_integrity"));
  assert.ok(rawReport.failed.includes("view_determinism"));

  const secondRoot = project(t, "store-revision");
  const second = saveSample(secondRoot);
  const revisionPath = path.join(second.dir, "revisions", "1.json");
  const revision = JSON.parse(fs.readFileSync(revisionPath, "utf8"));
  revision.raw_sha256 = "0".repeat(64);
  fs.writeFileSync(revisionPath, `${JSON.stringify(revision, null, 2)}\n`);
  const revisionReport = verifyConversation(secondRoot, "sample");
  assert.ok(revisionReport.failed.includes("revisions"));
});

test("recover clears a committed transaction directory", (t) => {
  const root = project(t, "store-committed");
  saveSample(root);
  const tx = path.join(root, ".export", "transactions", "tx-left");
  fs.mkdirSync(tx, { recursive: true });
  fs.writeFileSync(path.join(tx, "journal.json"), JSON.stringify({ stage: "committed", files: [] }));
  const report = recover(root);
  assert.ok(report.removed.includes("tx-left"));
  assert.equal(fs.existsSync(tx), false);
});

test("a conversation id with traversal is rejected", (t) => {
  const root = project(t, "store-id");
  assert.throws(
    () => saveConversation(root, { conversation: { id: "../escape" } }, { conversationId: "../escape" }),
    (error) => error.code === "INVALID_CONVERSATION_ID",
  );
});

test("readRaw returns every immutable raw record", (t) => {
  const root = project(t, "store-raw");
  saveSample(root);
  const raw = readRaw(root, "sample");
  assert.equal(raw.length, 2);
  assert.ok(raw.every((record) => record.hash && record.provenance));
});
