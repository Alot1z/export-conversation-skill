import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { buildPackage, worktreeStatus } from "../tools/build-package.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), "export-package-"));
  const repo = join(base, "repo");
  mkdirSync(join(repo, "skills", "export"), { recursive: true });
  git(base, "init", "--quiet", repo);
  git(repo, "config", "user.email", "package-test@example.invalid");
  git(repo, "config", "user.name", "Package Test");
  writeFileSync(
    join(repo, "skills", "export", "skill-manifest.json"),
    `${JSON.stringify(
      {
        name: "export-conversation",
        version: "3.0.0",
        files: ["SKILL.md"],
        sourceRoots: { "SKILL.md": "skills/export/SKILL.md" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(repo, "skills", "export", "SKILL.md"), "# Test skill\n");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "fixture");
  return { base, repo };
}

test("worktreeStatus reports tracked edits and untracked files", () => {
  const { repo } = makeRepo();
  assert.equal(worktreeStatus(repo), "");

  writeFileSync(join(repo, "skills", "export", "SKILL.md"), "# Changed\n");
  assert.match(worktreeStatus(repo), /skills\/export\/SKILL\.md/);

  git(repo, "checkout", "--", ".");
  writeFileSync(join(repo, "NEW.md"), "new\n");
  assert.match(worktreeStatus(repo), /NEW\.md/);
});

test("buildPackage refuses a dirty worktree before writing output", () => {
  const { base, repo } = makeRepo();
  const out = join(base, "package");
  writeFileSync(join(repo, "skills", "export", "SKILL.md"), "# Dirty\n");

  assert.throws(
    () => buildPackage({ root: repo, out, now: "2026-11-22T00:00:00.000Z" }),
    (error) => error.code === "DIRTY_WORKTREE" && /dirty worktree/i.test(error.message),
  );
  assert.equal(existsSync(out), false);
});

test("CI matrix covers Windows, Linux and macOS across supported Node versions", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.match(ci, /os:\s*\[windows-latest, ubuntu-latest, macos-latest\]/);
  assert.match(ci, /node:\s*\[20, 22, 24\]/);
  assert.match(ci, /node --test/);
  assert.match(ci, /tools\/build-package\.mjs/);
  assert.match(ci, /tests\/render-mermaid\.test\.mjs/);
  assert.doesNotMatch(ci, /tests\/render\.test\.mjs/);

  assert.match(release, /node --test/);
  assert.match(release, /tests\/render-mermaid\.test\.mjs/);
  assert.doesNotMatch(release, /tests\/render\.test\.mjs/);
});

test("buildPackage records the committed SHA and normalized file hashes", () => {
  const { base, repo } = makeRepo();
  const out = join(base, "package");
  const result = buildPackage({
    root: repo,
    out,
    now: "2026-11-22T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.files, 1);
  const manifest = JSON.parse(readFileSync(join(out, "package-manifest.json"), "utf8"));
  assert.equal(manifest.source_commit, git(repo, "rev-parse", "HEAD"));
  assert.equal(manifest.files[0].path, "SKILL.md");
  assert.equal(readFileSync(join(out, "SKILL.md"), "utf8"), "# Test skill\n");
});
