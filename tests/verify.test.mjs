import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verifyAll, verifyConversation, VERIFY_DIMENSIONS } from "../core/verify.mjs";
import { writeIndex } from "../core/service.mjs";
import { project, saveSample } from "./helpers/harness.mjs";

test("a clean conversation passes every dimension", (t) => {
  const root = project(t, "verify-clean");
  const saved = saveSample(root);
  writeIndex(root, { now: "2026-11-22T00:00:00.000Z" });
  const report = verifyConversation(root, "sample");
  assert.equal(report.ok, true, report.failed.join(","));
  assert.deepEqual(
    report.dimensions.map((entry) => entry.name),
    [...VERIFY_DIMENSIONS],
  );
});

test("view tampering is caught by the view hash and determinism checks", (t) => {
  const root = project(t, "verify-view");
  const saved = saveSample(root);
  const viewPath = path.join(saved.dir, "view", "conversation.json");
  const view = JSON.parse(fs.readFileSync(viewPath, "utf8"));
  view.records[0].content = "tampered";
  fs.writeFileSync(viewPath, `${JSON.stringify(view, null, 2)}\n`);
  const report = verifyConversation(root, "sample");
  assert.ok(report.failed.includes("view_determinism"));
});

test("rendered export tampering is caught by the render manifest", (t) => {
  const root = project(t, "verify-export");
  const saved = saveSample(root);
  fs.appendFileSync(path.join(saved.dir, "export.md"), "\nextra\n");
  const report = verifyConversation(root, "sample");
  assert.ok(report.failed.includes("render_manifest"));
});

test("secret-like content in a rendered export is caught by redaction", (t) => {
  const root = project(t, "verify-secret");
  const saved = saveSample(root);
  fs.appendFileSync(path.join(saved.dir, "export.md"), "\nsk-abcdefghijklmnopqrstuvwxyz012345\n");
  const report = verifyConversation(root, "sample");
  assert.ok(report.failed.includes("redaction"));
});

test("a promoted coverage claim contradicts the boundary", (t) => {
  const root = project(t, "verify-coverage");
  const saved = saveSample(
    root,
    { boundary: { history_complete: false, total_known: true, records_available: 2 } },
  );
  const metadataPath = path.join(saved.dir, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.coverage.source.status, "PARTIAL");
  metadata.coverage.source.status = "COMPLETE";
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const report = verifyConversation(root, "sample");
  assert.ok(report.failed.includes("source_boundary"));
  assert.ok(report.failed.includes("coverage_source"));
});

test("verifyAll aggregates conversations and project boundary checks", (t) => {
  const root = project(t, "verify-all");
  saveSample(root);
  writeIndex(root);
  const result = verifyAll(root);
  assert.equal(result.ok, true);
  assert.equal(result.conversations.length, 1);
  assert.ok(result.project.some((entry) => entry.name === "transactions"));
  assert.ok(result.project.some((entry) => entry.name === "lock"));
});

test("verifyAll fails when a transaction is left unrecovered", (t) => {
  const root = project(t, "verify-transaction");
  saveSample(root);
  const tx = path.join(root, ".export", "transactions", "tx-open");
  fs.mkdirSync(tx, { recursive: true });
  fs.writeFileSync(path.join(tx, "journal.json"), JSON.stringify({ stage: "staged", files: [] }));
  const result = verifyAll(root);
  assert.equal(result.ok, false);
  assert.ok(result.project.find((entry) => entry.name === "transactions").status === "FAIL");
});
