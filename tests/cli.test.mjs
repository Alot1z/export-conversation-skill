import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, "skills/export/scripts");

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [join(SCRIPT, script), ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
}

test("render-mermaid --help exits 0", () => {
  const result = run("render-mermaid.mjs", ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test("redact.mjs reports findings without printing values", () => {
  const result = run("redact.mjs", ["tests/fixtures/secret-export.md", "--json"]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /sk-abcdefghijklmnopqrstuvwx/);
  const report = JSON.parse(result.stdout);
  assert.ok(report.count > 0);
});

test("validate-export accepts the good fixture", () => {
  const result = run("validate-export.mjs", ["tests/fixtures/good-export.md"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("validate-export rejects the bad fixture", () => {
  const result = run("validate-export.mjs", ["tests/fixtures/bad-export.md"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /INVALID/);
});

test("install-skill installs and detects drift in a target", () => {
  const target = mkdtempSync(join(tmpdir(), "export-install-"));

  const missing = run("install-skill.mjs", ["--check", "--target", target, "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).targets[0].status, "missing");

  const installed = run("install-skill.mjs", ["--target", target, "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).targets[0].status, "installed");

  const clean = run("install-skill.mjs", ["--check", "--target", target, "--json"]);
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(JSON.parse(clean.stdout).targets[0].status, "ok");

  const readme = readFileSync(join(target, "SKILL.md"), "utf8");
  assert.match(readme, /Step 4b/);
});
