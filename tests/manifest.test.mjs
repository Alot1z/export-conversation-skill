import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { validateReleaseManifest } from "../skills/export/scripts/validate-release.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, "skills/export/scripts");
const SOURCE = join(ROOT, "skills/export");
const manifest = JSON.parse(readFileSync(join(SOURCE, "skill-manifest.json"), "utf8"));

const DEV_FILES = [
  "scripts/install-skill.mjs",
  "scripts/run-evals.mjs",
  "scripts/validate-release.mjs",
];

function run(args, options = {}) {
  return spawnSync(process.execPath, [join(SCRIPT, "install-skill.mjs"), ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(absolute, base));
    else result.push(relative(base, absolute).replaceAll("\\", "/"));
  }
  return result.sort();
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function report(result) {
  return JSON.parse(result.stdout);
}

test("manifest separates runtime files from development tooling", () => {
  assert.equal(manifest.files.length, 7);
  assert.ok(manifest.files.includes("SKILL.md"));
  for (const name of ["render-mermaid", "redact", "merge-export", "validate-export", "coverage", "assets"]) {
    assert.ok(manifest.files.includes(`scripts/${name}.mjs`), name);
  }
  assert.deepEqual(manifest.devFiles, DEV_FILES);
  for (const file of DEV_FILES) assert.ok(!manifest.files.includes(file), file);
});

test("fresh install contains exactly the runtime files", () => {
  const target = mkdtempSync(join(tmpdir(), "export-runtime-"));
  const result = run(["--target", target, "--json"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);

  assert.deepEqual(listFiles(target), [...manifest.files].sort());
  for (const file of DEV_FILES) assert.ok(!existsSync(join(target, file)), file);
});

test("check mode reports stale development files without mutating them", () => {
  const target = mkdtempSync(join(tmpdir(), "export-stale-"));
  assert.equal(run(["--target", target, "--json"]).status, 0);
  const stale = join(target, "scripts/run-evals.mjs");
  writeFileSync(stale, "stale");
  const before = hash(stale);

  const check = run(["--check", "--target", target, "--json"]);
  assert.equal(check.status, 1);
  const reportData = report(check);
  assert.equal(reportData.targets[0].status, "stale");
  assert.ok(reportData.targets[0].files.some((file) => file.file === "scripts/run-evals.mjs" && file.status === "stale"));
  assert.equal(hash(stale), before);
});

test("normal install prunes known stale development files and preserves unrelated files", () => {
  const target = mkdtempSync(join(tmpdir(), "export-prune-"));
  assert.equal(run(["--target", target, "--json"]).status, 0);
  for (const file of DEV_FILES) writeFileSync(join(target, file), "stale");
  writeFileSync(join(target, "NOTES.txt"), "user file");

  const installed = run(["--target", target, "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  for (const file of DEV_FILES) assert.ok(!existsSync(join(target, file)), file);
  assert.equal(readFileSync(join(target, "NOTES.txt"), "utf8"), "user file");
  assert.deepEqual(listFiles(target), [...manifest.files, "NOTES.txt"].sort());
});

test("--no-prune preserves stale development files", () => {
  const target = mkdtempSync(join(tmpdir(), "export-noprune-"));
  assert.equal(run(["--target", target, "--json"]).status, 0);
  const stale = join(target, "scripts/validate-release.mjs");
  writeFileSync(stale, "stale");

  const installed = run(["--target", target, "--no-prune", "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.ok(existsSync(stale));
  const check = run(["--check", "--target", target, "--json"]);
  assert.equal(check.status, 1);
});

test("hash drift is still detected and repaired", () => {
  const target = mkdtempSync(join(tmpdir(), "export-drift-"));
  assert.equal(run(["--target", target, "--json"]).status, 0);
  writeFileSync(join(target, "SKILL.md"), "drifted");

  const check = run(["--check", "--target", target, "--json"]);
  assert.equal(check.status, 1);
  assert.equal(report(check).targets[0].status, "drift");

  assert.equal(run(["--target", target, "--json"]).status, 0);
  assert.equal(run(["--check", "--target", target, "--json"]).status, 0);
});

test("project install writes only under .agents/skills and is deterministic", () => {
  const project = mkdtempSync(join(tmpdir(), "export-project-"));
  writeFileSync(join(project, "KEEP.md"), "keep");

  const installed = run(["--project", project, "--json"]);
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);

  const target = join(project, ".agents/skills/export-conversation");
  assert.deepEqual(listFiles(target), [...manifest.files].sort());
  assert.equal(readFileSync(join(project, "KEEP.md"), "utf8"), "keep");
  assert.equal(run(["--project", project, "--check", "--json"]).status, 0);

  writeFileSync(join(target, "SKILL.md"), "drifted");
  assert.equal(run(["--project", project, "--check", "--json"]).status, 1);
  assert.equal(run(["--project", project, "--json"]).status, 0);
  assert.equal(run(["--project", project, "--check", "--json"]).status, 0);
});

test("project install rejects a non-directory root and symlink escape", () => {
  const base = mkdtempSync(join(tmpdir(), "export-safe-"));
  const file = join(base, "not-a-dir");
  writeFileSync(file, "x");
  const nonDirectory = run(["--project", file, "--json"]);
  assert.equal(nonDirectory.status, 1);
  assert.match(nonDirectory.stderr + nonDirectory.stdout, /not a directory/i);

  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  try {
    symlinkSync(outside, join(project, ".agents"), "junction");
    const escaped = run(["--project", project, "--json"]);
    assert.equal(escaped.status, 1);
    assert.match(escaped.stderr + escaped.stdout, /outside|escape|contain/i);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EEXIST") throw error;
  }
});

test("release manifest validation accepts devFiles, rejects overlap and checks paths", () => {
  const valid = validateReleaseManifest(
    { files: ["SKILL.md", "scripts/redact.mjs"], devFiles: ["scripts/run-evals.mjs"] },
    SOURCE,
  );
  assert.deepEqual(valid.errors, []);

  const overlap = validateReleaseManifest(
    { files: ["SKILL.md", "scripts/redact.mjs"], devFiles: ["scripts/redact.mjs"] },
    SOURCE,
  );
  assert.ok(overlap.errors.some((error) => error.includes("both runtime and development")));

  const missing = validateReleaseManifest(
    { files: ["SKILL.md"], devFiles: ["scripts/not-there.mjs"] },
    SOURCE,
  );
  assert.ok(missing.errors.some((error) => error.includes("missing file")));

  const unclassified = validateReleaseManifest(
    { files: ["SKILL.md"], devFiles: [] },
    SOURCE,
  );
  assert.ok(unclassified.warnings.some((warning) => warning.includes("unclassified")));
});
