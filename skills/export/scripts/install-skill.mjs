#!/usr/bin/env node
/**
 * Install or check the skill in agent skill roots.
 *
 * Usage:
 *   node install-skill.mjs [--check] [--dry-run] [--json]
 *                          [--root <skills-root>] [--target <exact-dir>]
 *
 * Default targets cover the 12 roots used by this project when they exist.
 * --root installs to <root>/export-conversation. --target installs to an
 * exact directory. --check compares SHA-256 values and exits 1 on drift.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "2.2.0";
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(SOURCE, "skill-manifest.json"), "utf8"));
const HOME = process.env.USERPROFILE || process.env.HOME || "";

function defaultTargets() {
  const roots = [
    ".claude/skills/export-conversation",
    ".codex/skills/export-conversation",
    ".agents/skills/export-conversation",
    ".gemini/skills/export-conversation",
    ".cursor/skills/export-conversation",
    ".copilot/skills/export-conversation",
    ".cline/skills/export-conversation",
    ".codebuddy/skills/export-conversation",
    ".augment/skills/export-conversation",
    ".hermes/skills/export-conversation",
    "AppData/Roaming/chat-on-steroids/skills/export-conversation",
    ".claude/plugins/export-conversation/skills/export",
  ];
  return roots.map((root) => join(HOME, root));
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readTargetFile(target, file) {
  const path = join(target, file);
  return existsSync(path) ? readFileSync(path) : null;
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  rmSync(path, { force: true });
  renameSync(temporary, path);
}

function inspect(target) {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { path: target, status: "missing", files: [] };
  }
  if (!MANIFEST.files.some((file) => existsSync(join(target, file)))) {
    return { path: target, status: "missing", files: [] };
  }

  const files = MANIFEST.files.map((file) => {
    const current = readTargetFile(target, file);
    if (!current) return { file, status: "missing" };
    const expected = readFileSync(join(SOURCE, file));
    return { file, status: hash(current) === hash(expected) ? "ok" : "different" };
  });

  return {
    path: target,
    status: files.every((file) => file.status === "ok") ? "ok" : "drift",
    files,
  };
}

function install(target) {
  for (const file of MANIFEST.files) {
    writeAtomic(join(target, file), readFileSync(join(SOURCE, file)));
  }
  return { path: target, status: "installed", files: MANIFEST.files.map((file) => ({ file, status: "ok" })) };
}

function parseArgs(argv) {
  const options = { check: false, dryRun: false, json: false, help: false, roots: [], targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--root" || arg.startsWith("--root=")) options.roots.push(arg.startsWith("--root=") ? arg.slice("--root=".length) : value());
    else if (arg === "--target" || arg.startsWith("--target=")) options.targets.push(arg.startsWith("--target=") ? arg.slice("--target=".length) : value());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function main() {
  const usage =
    "Usage: node install-skill.mjs [--check] [--dry-run] [--json] [--root <skills-root>] [--target <exact-dir>]";
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(1);
  }

  if (options.help) {
    console.log(usage);
    return;
  }

  const explicit = [
    ...options.roots.map((root) => join(root, "export-conversation")),
    ...options.targets.map((target) => resolve(target)),
  ];
  const targets = [...new Set(explicit.length > 0 ? explicit : defaultTargets())];

  const results = [];
  for (const target of targets) {
    const before = inspect(target);
    if (options.check) {
      results.push(before);
    } else if (options.dryRun) {
      results.push({ ...before, status: before.status === "ok" ? "ok" : "would-install" });
    } else {
      results.push(before.status === "ok" ? before : install(target));
    }
  }

  const failing = results.filter((result) => ["missing", "drift"].includes(result.status));
  const report = {
    skill: MANIFEST.name,
    version: MANIFEST.version,
    mode: options.check ? "check" : options.dryRun ? "dry-run" : "install",
    ok: failing.length === 0,
    targets: results,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.status.padEnd(13)} ${result.path}`);
      for (const file of result.files.filter((entry) => entry.status !== "ok")) {
        console.log(`  ${file.status.padEnd(9)} ${file.file}`);
      }
    }
  }

  process.exit(failing.length === 0 ? 0 : 1);
}

const self = basename(fileURLToPath(import.meta.url));
if (process.argv[1] && basename(process.argv[1]) === self) {
  main();
}
