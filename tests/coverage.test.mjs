import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { coverageOf } from "../skills/export/scripts/coverage.mjs";

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
