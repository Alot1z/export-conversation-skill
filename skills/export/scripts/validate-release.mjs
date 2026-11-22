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

export const VERSION = "3.0.0";
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SOURCE, "../..");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function resolver(manifest) {
  const roots = manifest.sourceRoots ?? {};
  return (file) => join(ROOT, roots[file] ?? file);
}

export function validateReleaseManifest(manifest, source, options = {}) {
  const errors = [];
  const warnings = [];
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const devFiles = Array.isArray(manifest.devFiles) ? manifest.devFiles : [];
  const allowed = new Set([...files, ...devFiles]);
  const resolveFile = options.resolveFile ?? ((file) => join(source, file));
  const scriptsDir = options.scriptsDir ?? join(source, "scripts");

  for (const file of files) {
    if (devFiles.includes(file)) {
      errors.push(`manifest lists ${file} as both runtime and development`);
    }
  }

  for (const file of allowed) {
    if (!existsSync(resolveFile(file))) errors.push(`manifest lists a missing file: ${file}`);
  }

  if (existsSync(scriptsDir)) {
    for (const file of readdirSync(scriptsDir)) {
      if (file.endsWith(".mjs") && !allowed.has(`scripts/${file}`)) {
        warnings.push(`unclassified script in scripts/: ${file}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, runtime: files.length, development: devFiles.length };
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
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
    errors.push("core must not have npm runtime dependencies");
  }

  for (const file of ["LICENSE", "README.md", "CHANGELOG.md", "skills/export/SKILL.md", "skills/export/skill-manifest.json"]) {
    if (!existsSync(join(ROOT, file))) errors.push(`missing required file: ${file}`);
  }

  const manifestCheck = validateReleaseManifest(manifest, SOURCE, {
    resolveFile: resolver(manifest),
    scriptsDir: join(SOURCE, "scripts"),
  });
  errors.push(...manifestCheck.errors);
  warnings.push(...manifestCheck.warnings);

  for (const file of [
    "core/canonical.mjs",
    "core/store.mjs",
    "core/verify.mjs",
    "adapters/index.mjs",
    "catalogue/harnesses.json",
    "schemas/canonical.schema.json",
    "scripts/conversation.mjs",
    "scripts/mcp-server.mjs",
  ]) {
    if (!existsSync(resolver(manifest)(file))) errors.push(`missing 3.0 runtime file: ${file}`);
  }
  if (!manifest.files.includes("scripts/project-export.mjs")) {
    errors.push("skill-manifest.json does not ship scripts/project-export.mjs");
  }
  if (!existsSync(join(SOURCE, "schemas/project-export.schema.json"))) {
    errors.push("missing project export metadata schema");
  }

  if (readme.includes("YOUR_USERNAME")) errors.push("README.md still contains YOUR_USERNAME");
  if (!readme.includes("https://github.com/Alot1z/export-conversation-skill")) {
    errors.push("README.md does not link to the live fork");
  }
  if (!readme.includes("render-mermaid.mjs") || !readme.includes("redact.mjs")) {
    errors.push("README.md does not document the renderer and redaction gate");
  }
  if (!readme.includes("scripts/conversation.mjs")) {
    errors.push("README.md does not document the 3.0 CLI");
  }
  if (!skill.includes("Step 4b") || !skill.includes("validate-export.mjs")) {
    errors.push("SKILL.md is missing the validation workflow");
  }
  if (!skill.includes("project-export.mjs") || !skill.includes("Step 4e")) {
    errors.push("SKILL.md is missing the project export workflow");
  }
  if (!skill.includes("3.0.0") || !skill.includes("scripts/conversation.mjs")) {
    errors.push("SKILL.md does not describe the 3.0 core");
  }
  if (!skill.includes("coverage_source")) {
    errors.push("SKILL.md does not document dimensioned coverage");
  }
  if (plugin.repository?.url !== "https://github.com/Alot1z/export-conversation-skill.git") {
    errors.push("plugin.json repository URL is not the live fork");
  }
  if (existsSync(join(ROOT, "docs/development"))) {
    errors.push("docs/development must not be part of the published tree");
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
