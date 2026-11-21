#!/usr/bin/env node
/**
 * Validate a conversation export before it is shared or committed.
 *
 * Usage:
 *   node validate-export.mjs <file.md> [--manifest <file>] [--strict] [--json]
 *
 * Checks front matter, required sections, message markers, coverage, secrets
 * and the render manifest produced by render-mermaid.mjs. Exit 1 on errors.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scanSecrets } from "./redact.mjs";
import { extractMessages, parseFrontMatter } from "./merge-export.mjs";
import { extractBlocks } from "./render-mermaid.mjs";

export const VERSION = "2.2.0";

const REQUIRED_MARKERS = [
  "<!-- export:generated:summary:start -->",
  "<!-- export:generated:summary:end -->",
  "<!-- export:generated:stats:start -->",
  "<!-- export:generated:stats:end -->",
  "<!-- export:generated:files:start -->",
  "<!-- export:generated:files:end -->",
  "<!-- export:messages:start -->",
  "<!-- export:messages:end -->",
];

const REQUIRED_HEADINGS = [
  "## Conversation Summary",
  "## Full Conversation",
  "## Session Statistics",
  "## Files Changed",
];

export function validateExport(text, options = {}) {
  const errors = [];
  const warnings = [];
  const doc = parseFrontMatter(text);

  if (!doc.data) {
    errors.push("missing YAML front matter (export_id, last_message, generated_at, coverage)");
  } else {
    for (const key of ["export_id", "last_message", "generated_at", "coverage"]) {
      if (!doc.data[key]) errors.push(`front matter is missing "${key}"`);
    }
    if (doc.data.coverage && /^partial/i.test(doc.data.coverage)) {
      warnings.push(`coverage is partial: ${doc.data.coverage}`);
    }
  }

  for (const marker of REQUIRED_MARKERS) {
    if (!text.includes(marker)) errors.push(`missing marker ${marker}`);
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!text.includes(heading)) errors.push(`missing section "${heading}"`);
  }

  const messages = extractMessages(text);
  if (messages.length === 0) errors.push("no <!-- export:message:N --> entries found");
  if (messages.length > 0) {
    const indexes = messages.map((message) => message.index).sort((left, right) => left - right);
    if (new Set(indexes).size !== indexes.length) errors.push("duplicate message markers");
    if (doc.data?.last_message && Number(doc.data.last_message) !== indexes.at(-1)) {
      errors.push(`last_message is ${doc.data.last_message} but the highest marker is ${indexes.at(-1)}`);
    }
    if (indexes[0] !== 1) warnings.push(`message numbering starts at ${indexes[0]} instead of 1`);
    const missing = indexes.filter((value, position) => value !== position + 1);
    if (missing.length > 0) warnings.push("message markers contain gaps");
  }

  for (const finding of scanSecrets(text)) {
    errors.push(`possible secret at line ${finding.line}: ${finding.type}`);
  }

  const diagramCount = extractBlocks(text).length;
  const manifest = options.manifest ?? null;

  if (diagramCount > 0) {
    if (!manifest) {
      errors.push(`render manifest missing; run render-mermaid.mjs with --manifest for ${diagramCount} diagram(s)`);
    } else {
      if (manifest.ok !== true) errors.push("render manifest reports a failed render");
      const rendered = Array.isArray(manifest.diagrams) ? manifest.diagrams.length : 0;
      if (rendered !== diagramCount) {
        errors.push(`render manifest has ${rendered} diagram(s) but the export has ${diagramCount}`);
      }
      for (const diagram of manifest.diagrams ?? []) {
        for (const warning of diagram.warnings ?? []) {
          warnings.push(`diagram ${diagram.index}: ${warning}`);
        }
      }
    }
  } else if (manifest?.ok === false) {
    errors.push("render manifest reports a failed render");
  }

  if (options.strict) {
    errors.push(...warnings.map((warning) => `strict: ${warning}`));
  }

  return { ok: errors.length === 0, errors, warnings, messages: messages.length, diagrams: diagramCount };
}

function defaultManifest(file) {
  const parsed = resolve(file);
  const name = basename(parsed).replace(/\.md$/i, "");
  return join(dirname(parsed), `${name}.manifest.json`);
}

function parseArgs(argv) {
  const options = { file: null, manifest: null, strict: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--manifest" || arg.startsWith("--manifest=")) {
      options.manifest = arg.startsWith("--manifest=") ? arg.slice("--manifest=".length) : value();
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Pass one Markdown file at a time");
    else options.file = arg;
  }
  return options;
}

function main() {
  const usage = "Usage: node validate-export.mjs <file.md> [--manifest <file>] [--strict] [--json]";
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(1);
  }

  if (options.help || !options.file) {
    console.log(usage);
    process.exit(options.help ? 0 : 1);
  }

  let text;
  try {
    text = readFileSync(options.file, "utf8");
  } catch (error) {
    console.error(`Cannot read ${options.file}: ${error.message}`);
    process.exit(1);
  }

  const manifestPath = options.manifest ?? defaultManifest(options.file);
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      console.error(`Cannot parse ${manifestPath}: ${error.message}`);
      process.exit(1);
    }
  }

  const result = validateExport(text, { manifest, strict: options.strict });
  const report = { file: basename(options.file), ...result };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${options.file}: ${result.ok ? "valid" : "INVALID"}`);
    for (const error of result.errors) console.log(`error: ${error}`);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
    console.log(`${result.messages} message(s), ${result.diagrams} diagram(s)`);
  }

  process.exit(result.ok ? 0 : 1);
}

const self = basename(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? basename(process.argv[1]) : "";
if (invoked && decodeURIComponent(self) === invoked) {
  main();
}
