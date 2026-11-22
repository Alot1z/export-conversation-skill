import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVENANCE,
  SCHEMA_VERSION,
  buildView,
  hashObject,
  makeRecord,
  sha256,
  stableStringify,
  validateConversation,
} from "../core/canonical.mjs";
import { applyCoverage } from "../core/coverage.mjs";

test("stable stringify and hashes do not depend on key order", () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(hashObject(left), hashObject(right));
  assert.equal(sha256("abc").length, 64);
});

test("records are immutable, hashed and preserve raw payloads", () => {
  const raw = { source: "fixture", line: 1 };
  const record = makeRecord({ role: "user", content: "hello", raw });
  assert.equal(record.provenance, "UNKNOWN");
  assert.equal(record.hash.length, 64);
  assert.equal(record.rawHash, hashObject(raw));
  const again = makeRecord({ content: "hello", role: "user", raw });
  assert.equal(again.hash, record.hash);
  assert.equal(record.raw, raw);
});

test("buildView orders records, resolves branches and pairs tools", () => {
  const view = buildView({
    conversation: { id: "c", title: "C" },
    source: { adapter: "test", kind: "generic-import" },
    records: [
      { seq: 2, role: "tool", type: "tool_result", content: "ok", toolCallId: "t2" },
      { seq: 0, role: "user", content: "one", branchId: "main" },
      { seq: 1, role: "assistant", type: "tool_call", content: "{}", toolCallId: "t1" },
      { seq: 3, role: "assistant", content: "alt", branchId: "side" },
      { seq: 4, role: "tool", type: "tool_result", content: "orphan", toolCallId: "t3" },
    ],
    boundary: { total_known: true, records_available: 5, history_complete: false },
  });
  assert.deepEqual(
    view.records.map((record) => record.seq),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    view.branches.map((branch) => branch.id),
    ["main", "side"],
  );
  assert.equal(view.conversation.active_branch, "main");
  assert.deepEqual(
    view.tool_pairs.map((pair) => [pair.callId, pair.status]),
    [
      ["t1", "missing_result"],
      ["t2", "orphan_result"],
      ["t3", "orphan_result"],
    ],
  );
});

test("validation rejects duplicate ids, invalid provenance and missing coverage", () => {
  const view = buildView({ conversation: { id: "c" }, source: { adapter: "test", kind: "generic-import" }, records: [] });
  view.records = [makeRecord({ id: "same", role: "user", content: "a" }), makeRecord({ id: "same", role: "user", content: "b" })];
  view.records[1].provenance = "FABRICATED";
  const result = validateConversation(view);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("duplicate")));
  assert.ok(result.errors.some((error) => error.includes("provenance")));
  assert.ok(result.errors.some((error) => error.includes("coverage")));
});

test("unknown records stay unknown and keep their evidence", () => {
  const view = buildView({
    conversation: { id: "c" },
    source: { adapter: "test", kind: "generic-import" },
    records: [{ seq: 0, role: "unknown", type: "unknown", content: "raw line", unknown: true, raw: { line: 7 } }],
    boundary: { total_known: true, records_available: 1, history_complete: true },
  });
  applyCoverage(view, { boundary: view.boundary });
  assert.equal(view.records[0].type, "unknown");
  assert.equal(view.records[0].raw.line, 7);
  assert.equal(view.coverage.counts.unknown, 1);
  assert.ok(PROVENANCE.includes(view.records[0].provenance));
  assert.equal(SCHEMA_VERSION, 2);
});
