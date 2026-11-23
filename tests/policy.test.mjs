import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { checkMessage } from "../tools/check-commit-policy.mjs";

const CHECKER = fileURLToPath(new URL("../tools/check-commit-policy.mjs", import.meta.url));

test("rejects co-author and generated-with attribution", () => {
  const violations = checkMessage([
    "feat: add a thing",
    "",
    "Generated with Codebuff",
    "Co-Authored-By: Codebuff <noreply@codebuff.com>",
  ].join("\n"));

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ["generated-with attribution", "co-author trailer"],
  );
});

test("rejects tool names in any case and any line", () => {
  assert.equal(checkMessage("fix: remove Freebuff fallback").length, 1);
  assert.equal(checkMessage("docs: explain why codebuff is not used").length, 1);
});

test("rejects emoji but accepts plain text", () => {
  assert.equal(checkMessage("feat: add export support").length, 0);
  assert.equal(checkMessage("feat: add export support\n\nNo attribution here.").length, 0);
  assert.equal(checkMessage("feat: add export support \u{1F916}").length, 1);
});

test("the message-file CLI exits non-zero for a violation", () => {
  const directory = mkdtempSync(join(tmpdir(), "export-policy-"));
  const dirty = join(directory, "dirty.txt");
  const clean = join(directory, "clean.txt");
  writeFileSync(dirty, "feat: add a thing\n\nCo-Authored-By: Codebuff <noreply@codebuff.com>\n");
  writeFileSync(clean, "feat: add a thing\n\nKeep the raw evidence.\n");

  const failed = spawnSync(process.execPath, [CHECKER, "--message-file", dirty], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /co-author trailer/);

  const passed = spawnSync(process.execPath, [CHECKER, "--message-file", clean], { encoding: "utf8" });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /pass/);
});
