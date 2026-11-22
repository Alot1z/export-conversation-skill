import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFixtures } from "./helpers/fixtures.mjs";
import { project } from "./helpers/harness.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, "skills/export/scripts");
const CONVERSATION = join(ROOT, "scripts/conversation.mjs");

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [join(SCRIPT, script), ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
}

function runConversation(args, options = {}) {
  return spawnSync(process.execPath, [CONVERSATION, ...args], {
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

test("conversation version and doctor expose the runtime", () => {
  const version = runConversation(["version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(JSON.parse(version.stdout).version, "3.0.0");
  const doctor = runConversation(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /PASS adapters/);
  assert.match(doctor.stdout, /PASS zip-crc/);
});

test("conversation import, list, verify, search and export work end to end", (t) => {
  const root = project(t, "cli-conversation");
  const fixtures = writeFixtures(join(root, "src"));
  const imported = runConversation([
    "import",
    "--adapter",
    "generic-json",
    "--input",
    fixtures.genericJson,
    "--project",
    root,
    "--id",
    "cli-one",
    "--now",
    "2026-11-22T03:00:00.000Z",
  ]);
  assert.equal(imported.status, 0, imported.stdout + imported.stderr);
  const summary = JSON.parse(imported.stdout);
  assert.equal(summary.conversation_id, "cli-one");
  assert.equal(summary.coverage.source.status, "COMPLETE");

  const list = runConversation(["list", "--project", root]);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /cli-one \| Imported/);

  const verified = runConversation(["verify", "--all", "--project", root]);
  assert.equal(verified.status, 0, verified.stdout);
  assert.match(verified.stdout, /verify: ok/);

  const search = runConversation(["search", "--text", "answer", "--project", root]);
  assert.equal(search.status, 0);
  assert.equal(JSON.parse(search.stdout).hits.length, 1);

  const exported = runConversation(["export", "--id", "cli-one", "--format", "md", "--project", root]);
  assert.equal(exported.status, 0);
  assert.match(exported.stdout, /conversation_id: "cli-one"/);
  assert.match(exported.stdout, /coverage_source: COMPLETE/);

  const index = runConversation(["index", "--project", root]);
  assert.equal(index.status, 0);
  assert.match(readFileSync(join(root, ".export", "index.md"), "utf8"), /cli-one/);
});

test("conversation import refuses an unknown adapter", () => {
  const result = runConversation([
    "import",
    "--adapter",
    "does-not-exist",
    "--input",
    "missing.json",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown adapter/);
});

test("conversation verify exits non-zero after export tampering", (t) => {
  const root = project(t, "cli-tamper");
  const fixtures = writeFixtures(join(root, "src"));
  const imported = runConversation([
    "import",
    "--adapter",
    "generic-json",
    "--input",
    fixtures.genericJson,
    "--project",
    root,
    "--id",
    "cli-tamper",
    "--now",
    "2026-11-22T03:00:00.000Z",
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  const exportPath = join(root, ".export", "conversations", "cli-tamper", "export.md");
  appendFileSync(exportPath, "\ntampered\n");
  const verified = runConversation(["verify", "--id", "cli-tamper", "--project", root]);
  assert.equal(verified.status, 1);
  assert.match(verified.stdout, /FAIL|verify: failed/);
});
