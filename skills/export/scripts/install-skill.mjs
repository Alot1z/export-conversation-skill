#!/usr/bin/env node
/**
 * Install or check the skill in agent skill roots.
 *
 * Usage:
 *   node install-skill.mjs [--check] [--dry-run] [--json] [--no-prune]
 *                          [--root <skills-root>] [--target <exact-dir>]
 *                          [--project <project-root>] [--force]
 *
 * Default targets cover the 12 roots used by this project when they exist.
 * --root installs to <root>/export-conversation. --target installs to an
 * exact directory. --project installs to
 * <project>/.agents/skills/export-conversation.
 *
 * Only manifest.files are installed. Known manifest.devFiles left by older
 * versions are reported as stale by --check and removed during a normal
 * install unless --no-prune is passed. --force allows installing over a
 * non-empty directory that is not an existing export-conversation install.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "2.2.1";
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(SOURCE, "skill-manifest.json"), "utf8"));
const RUNTIME = MANIFEST.files;
const DEV = MANIFEST.devFiles ?? [];
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

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function projectTarget(root) {
  const absolute = resolve(root);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error(`--project root is not a directory: ${absolute}`);
  }

  const realRoot = realpathSync(absolute);
  const target = join(realRoot, ".agents", "skills", "export-conversation");
  if (!isInside(realRoot, target)) {
    throw new Error(`--project target escapes the project root: ${target}`);
  }

  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const realAncestor = realpathSync(ancestor);
  if (!isInside(realRoot, realAncestor)) {
    throw new Error(`--project target escapes the project root: ${target}`);
  }

  if (existsSync(target)) {
    const realTarget = realpathSync(target);
    if (!isInside(realRoot, realTarget)) {
      throw new Error(`--project target escapes the project root: ${target}`);
    }
  }

  return target;
}

function inspect(target) {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { path: target, status: "missing", files: [] };
  }
  if (!RUNTIME.some((file) => existsSync(join(target, file)))) {
    return { path: target, status: "missing", files: [] };
  }

  const files = RUNTIME.map((file) => {
    const current = readTargetFile(target, file);
    if (!current) return { file, status: "missing" };
    const expected = readFileSync(join(SOURCE, file));
    return { file, status: hash(current) === hash(expected) ? "ok" : "different" };
  });
  const stale = DEV.filter((file) => existsSync(join(target, file))).map((file) => ({
    file,
    status: "stale",
  }));

  const status = files.some((file) => file.status !== "ok")
    ? "drift"
    : stale.length > 0
      ? "stale"
      : "ok";

  return { path: target, status, files: [...files, ...stale] };
}

function install(target, prune) {
  for (const file of RUNTIME) {
    writeAtomic(join(target, file), readFileSync(join(SOURCE, file)));
  }

  const pruned = [];
  if (prune) {
    for (const file of DEV) {
      if (existsSync(join(target, file))) {
        rmSync(join(target, file), { force: true });
        pruned.push(file);
      }
    }
  }

  return {
    path: target,
    status: "installed",
    files: RUNTIME.map((file) => ({ file, status: "ok" })),
    pruned,
  };
}

function needsForce(target) {
  if (!existsSync(target) || !statSync(target).isDirectory()) return false;
  if (readdirSync(target).length === 0) return false;
  return !RUNTIME.some((file) => existsSync(join(target, file)));
}

function parseArgs(argv) {
  const options = {
    check: false,
    dryRun: false,
    json: false,
    noPrune: false,
    force: false,
    help: false,
    roots: [],
    targets: [],
    projects: [],
  };
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
    else if (arg === "--no-prune") options.noPrune = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--root" || arg.startsWith("--root=")) options.roots.push(arg.startsWith("--root=") ? arg.slice("--root=".length) : value());
    else if (arg === "--target" || arg.startsWith("--target=")) options.targets.push(arg.startsWith("--target=") ? arg.slice("--target=".length) : value());
    else if (arg === "--project" || arg.startsWith("--project=")) options.projects.push(arg.startsWith("--project=") ? arg.slice("--project=".length) : value());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function main() {
  const usage =
    "Usage: node install-skill.mjs [--check] [--dry-run] [--json] [--no-prune] [--root <skills-root>] [--target <exact-dir>] [--project <project-root>] [--force]";
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

  let explicit;
  try {
    explicit = [
      ...options.roots.map((root) => join(root, "export-conversation")),
      ...options.targets.map((target) => resolve(target)),
      ...options.projects.map((project) => projectTarget(project)),
    ];
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const targets = [...new Set(explicit.length > 0 ? explicit : defaultTargets())];
  const results = [];

  for (const target of targets) {
    const before = inspect(target);
    if (options.check) {
      results.push(before);
    } else if (options.dryRun) {
      results.push({ ...before, status: before.status === "ok" ? "ok" : "would-install" });
    } else {
      if (needsForce(target) && !options.force) {
        console.error(
          `Target exists but is not an export-conversation install: ${target}\nPass --force to install into it without deleting unrelated files.`,
        );
        process.exit(1);
      }
      results.push(before.status === "ok" ? before : install(target, !options.noPrune));
    }
  }

  const failing = results.filter((result) => !["ok", "installed"].includes(result.status));
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
      for (const file of result.pruned ?? []) console.log(`  pruned    ${file}`);
    }
  }

  process.exit(failing.length === 0 ? 0 : 1);
}

const self = basename(fileURLToPath(import.meta.url));
if (process.argv[1] && basename(process.argv[1]) === self) {
  main();
}
