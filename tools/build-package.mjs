#!/usr/bin/env node
/**
 * Build a reproducible, installable skill package from the current commit.
 *
 * The package manifest binds every file to a SHA-256 and the whole package to
 * the HEAD commit, so installation can verify the artifact rather than the
 * ambient working tree.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "skills", "export", "skill-manifest.json"), "utf8"),
);

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

function sourceFor(file) {
  return path.join(ROOT, MANIFEST.sourceRoots?.[file] ?? file);
}

function normalizedContent(file) {
  const content = fs.readFileSync(sourceFor(file));
  if (/\.(?:png|jpe?g|gif|webp|zip|ico)$/i.test(file)) return content;
  return Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"));
}

const options = parseArgs(process.argv.slice(2));
const out = path.resolve(options.out ?? process.env.EXPORT_CONVERSATION_PACKAGE ?? path.join(ROOT, "..", ".account-package"));
const now =
  options.now ??
  (process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString());
const sourceCommit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();

if (options.clean === true || options.clean === "true") {
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

const files = [];
for (const file of [...MANIFEST.files].sort()) {
  const source = sourceFor(file);
  if (!fs.existsSync(source)) throw new Error(`manifest file is missing: ${file} (${source})`);
  const content = normalizedContent(file);
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  files.push({ path: file, bytes: content.length, sha256: sha256(content) });
}

const manifest = {
  schema_version: 1,
  name: MANIFEST.name,
  version: MANIFEST.version,
  source_commit: sourceCommit,
  generated_at: now,
  files,
};
fs.writeFileSync(path.join(out, "package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const byPath = new Map(files.map((entry) => [entry.path, entry]));
for (const file of MANIFEST.files) {
  const entry = byPath.get(file);
  if (!entry) throw new Error(`package did not include ${file}`);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    output: out,
    version: MANIFEST.version,
    source_commit: sourceCommit,
    files: files.length,
    bytes: files.reduce((total, entry) => total + entry.bytes, 0),
  }, null, 2)}\n`,
);
