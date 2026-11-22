#!/usr/bin/env node
/**
 * Build a reproducible, installable skill package from the current commit.
 *
 * The package manifest binds every file to a SHA-256 and the whole package to
 * the HEAD commit, so installation can verify the artifact rather than the
 * ambient working tree. A dirty worktree is refused before any output is
 * touched: a package must describe committed content, not local edits.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    options[key] = inline ?? argv[++index] ?? true;
  }
  return options;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function worktreeStatus(root = MODULE_ROOT) {
  return execFileSync(
    "git",
    ["-C", root, "status", "--porcelain", "--untracked-files=normal"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function sourceFor(root, manifest, file) {
  return path.join(root, manifest.sourceRoots?.[file] ?? file);
}

function normalizedContent(root, manifest, file) {
  const content = fs.readFileSync(sourceFor(root, manifest, file));
  if (/\.(?:png|jpe?g|gif|webp|zip|ico)$/i.test(file)) return content;
  return Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"));
}

export function buildPackage(options = {}) {
  const root = path.resolve(options.root ?? MODULE_ROOT);
  const out = path.resolve(
    options.out ??
      process.env.EXPORT_CONVERSATION_PACKAGE ??
      path.join(root, "..", ".account-package"),
  );
  const now =
    options.now ??
    (process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString());

  const dirty = worktreeStatus(root);
  if (dirty) {
    const error = new Error(`Refusing to build from a dirty worktree:\n${dirty}`);
    error.code = "DIRTY_WORKTREE";
    throw error;
  }

  const manifestPath = path.join(root, "skills", "export", "skill-manifest.json");
  const manifestSource = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  if (options.clean === true || options.clean === "true") {
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });

  const files = [];
  for (const file of [...manifestSource.files].sort()) {
    const source = sourceFor(root, manifestSource, file);
    if (!fs.existsSync(source)) {
      throw new Error(`manifest file is missing: ${file} (${source})`);
    }
    const content = normalizedContent(root, manifestSource, file);
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push({ path: file, bytes: content.length, sha256: sha256(content) });
  }

  const manifest = {
    schema_version: 1,
    name: manifestSource.name,
    version: manifestSource.version,
    source_commit: sourceCommit,
    generated_at: now,
    files,
  };
  fs.writeFileSync(
    path.join(out, "package-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  for (const file of manifestSource.files) {
    if (!byPath.has(file)) throw new Error(`package did not include ${file}`);
  }

  return {
    ok: true,
    output: out,
    version: manifestSource.version,
    source_commit: sourceCommit,
    files: files.length,
    bytes: files.reduce((total, entry) => total + entry.bytes, 0),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = buildPackage({
      out: options.out,
      now: options.now,
      clean: options.clean,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`build-package: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
