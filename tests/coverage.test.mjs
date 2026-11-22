import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { coverageOf } from "../skills/export/scripts/coverage.mjs";
import {
  applyCoverage,
  computeCoverage,
  computeExportCoverage,
  computeSelectionCoverage,
  computeSourceCoverage,
  normalizeBoundary,
} from "../core/coverage.mjs";
import { buildView } from "../core/canonical.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("coverageOf counts roles and marks full coverage", () => {
  const result = coverageOf({
    session_id: "s1",
    harness: "test",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "tool", content: "ok" },
    ],
  });
  assert.equal(result.messages, 3);
  assert.equal(result.counts.user, 1);
  assert.equal(result.counts.assistant, 1);
  assert.equal(result.last_message, 3);
  assert.equal(result.coverage, "full");
});

test("coverageOf rejects malformed transcripts", () => {
  assert.throws(() => coverageOf({ messages: [] }), /session_id/);
  assert.throws(() => coverageOf({ session_id: "s", messages: [] }), /messages/);
  assert.throws(() => coverageOf({ session_id: "s", messages: [{ role: "nope", content: "" }] }), /unknown role/);
});

test("export-contract evals pass", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "skills/export/scripts/run-evals.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pass\s+valid export/);
});

const records = [
  { id: "a", role: "user" },
  { id: "b", role: "assistant" },
  { id: "c", role: "tool" },
];

test("source coverage distinguishes complete, partial, unknown and unavailable", () => {
  assert.equal(
    computeSourceCoverage(
      normalizeBoundary({ kind: "file", total_known: true, records_available: 3, history_complete: true }, records),
      records,
    ).status,
    "COMPLETE",
  );
  assert.equal(
    computeSourceCoverage(
      normalizeBoundary({ kind: "file", total_known: true, records_available: 5, history_complete: false }, records),
      records,
    ).status,
    "PARTIAL",
  );
  assert.equal(
    computeSourceCoverage(
      normalizeBoundary({ kind: "context", total_known: false, records_available: 3, history_complete: false }, records),
      records,
    ).status,
    "UNKNOWN",
  );
  assert.equal(
    computeSourceCoverage(normalizeBoundary({ kind: "file", total_known: true, history_complete: true }, []), []).status,
    "UNAVAILABLE",
  );
});

test("selection and export are computed independently", () => {
  assert.equal(computeSelectionCoverage(records, null).status, "COMPLETE");
  assert.equal(computeSelectionCoverage(records, ["a"]).status, "PARTIAL");
  assert.equal(computeSelectionCoverage(records, []).status, "UNAVAILABLE");
  assert.equal(computeExportCoverage(3, 3).status, "COMPLETE");
  assert.equal(computeExportCoverage(3, 2).status, "PARTIAL");
  assert.equal(computeExportCoverage(3, 0).status, "UNAVAILABLE");
});

test("computeCoverage never promotes a partial source to complete", () => {
  const coverage = computeCoverage({
    records,
    boundary: { kind: "context", total_known: false, records_available: 3, history_complete: false },
  });
  assert.equal(coverage.source.status, "UNKNOWN");
  assert.equal(coverage.selection.status, "COMPLETE");
  assert.equal(coverage.export.status, "COMPLETE");
  assert.equal(coverage.counts.total, 3);
});

test("applyCoverage attaches boundary evidence to a view", () => {
  const view = buildView({
    conversation: { id: "c" },
    source: { adapter: "test", kind: "generic-import" },
    records,
    boundary: { kind: "file", total_known: true, records_available: 3, history_complete: false },
  });
  applyCoverage(view);
  assert.equal(view.coverage.source.status, "PARTIAL");
  assert.equal(view.boundary.records_captured, 3);
  assert.equal(view.coverage.boundary.kind, "file");
});
