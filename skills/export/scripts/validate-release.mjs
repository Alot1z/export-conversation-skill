#!/usr/bin/env node
/**
 * Check that the repository is internally consistent and ready to tag.
 *
 * Usage:
 *   node validate-release.mjs [--json]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "2.2.0";
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SOURCE, "../..");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

export function validateRelease() {
  const errors = [];
  const warnings = [];
  const packageJson = readJson("package.json");
  const manifest = readJson("skills/export/skill-manifest.json");
  const plugin = readJson(".claude-plugin/plugin.json");
  const changelog = read("CHANGELOG.md");
  const readme = read("README.md");
  const skill = read("skills/export/SKILL.md");

  const versions = {
    package: packageJson.version,
    manifest: manifest.version,
    plugin: plugin.version,
  };
  if (new Set(Object.values(versions)).size !== 1) {
    errors.push(`version mismatch: ${JSON.stringify(versions)}`);
  }
  if (!changelog.includes(`## [${manifest.version}]`)) {
    errors.push(`CHANGELOG.md has no ${manifest.version} section`);
  }
  if (!packageJson.scripts?.test) warnings.push("package.json has no test script");

  for (const file of ["LICENSE", "README.md", "CHANGELOG.md", "skills/export/SKILL.md", "skills/export/skill-manifest.json"]) {
    if (!existsSync(join(ROOT, file))) errors.push(`missing required file: ${file}`);
  }

  const manifestFiles = new Set(manifest.files);
  for (const file of manifest.files) {
    if (!existsSync(join(SOURCE, file))) errors.push(`manifest lists a missing file: ${file}`);
  }
  for (const file of readdirSync(join(SOURCE, "scripts"))) {
    if (file.endsWith(".mjs") && !manifestFiles.has(`scripts/${file}`)) {
      warnings.push(`script not listed in skill-manifest.json: scripts/${file}`);
    }
  }

  if (readme.includes("YOUR_USERNAME")) errors.push("README.md still contains YOUR_USERNAME");
  if (!readme.includes("https://github.com/Alot1z/export-conversation-skill")) {
    errors.push("README.md does not link to the live fork");
  }
  if (!readme.includes("render-mermaid.mjs") || !readme.includes("redact.mjs")) {
    errors.push("README.md does not document the renderer and redaction gate");
  }
  if (!skill.includes("Step 4b") || !skill.includes("validate-export.mjs")) {
    errors.push("SKILL.md is missing the validation workflow");
  }
  if (plugin.repository?.url !== "https://github.com/Alot1z/export-conversation-skill.git") {
    errors.push("plugin.json repository URL is not the live fork");
  }

  return { ok: errors.length === 0, errors, warnings, versions };
}

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log("Usage: node validate-release.mjs [--json]");
    return;
  }

  const result = validateRelease();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.ok ? `Release ${result.versions.manifest}: valid` : "Release: INVALID");
    for (const error of result.errors) console.log(`error: ${error}`);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
  }

  process.exit(result.ok ? 0 : 1);
}

const self = basename(fileURLToPath(import.meta.url));
if (process.argv[1] && basename(process.argv[1]) === self) {
  main();
}
