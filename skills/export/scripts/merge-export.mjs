#!/usr/bin/env node
/**
 * Merge a fresh export into an existing one without duplicating messages.
 *
 * Usage:
 *   node merge-export.mjs --existing old.md --new new.md --out merged.md
 *                         [--force] [--dry-run] [--json]
 *
 * Both documents must use the export template markers:
 *   <!-- export:messages:start --> ... <!-- export:messages:end -->
 *   <!-- export:message:N -->
 *   <!-- export:manual:<id>:start --> ... <!-- export:manual:<id>:end -->
 *
 * Generated sections come from the new document. Messages already present in
 * the old document are kept once, and messages with a higher index are
 * appended. Manual blocks keep the old content. A mismatched export_id is
 * refused unless --force is passed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export const VERSION = "2.2.0";

const MESSAGE = /<!-- export:message:(\d+) -->\r?\n([\s\S]*?)(?=<!-- export:message:\d+ -->|<!-- export:messages:end -->)/g;
const REGION = /<!-- export:messages:start -->[\s\S]*?<!-- export:messages:end -->/;
const MANUAL = /<!-- export:manual:([a-z0-9-]+):start -->([\s\S]*?)<!-- export:manual:\1:end -->/g;

export function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { data: null, body: text, raw: "" };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      data[line.slice(0, separator).trim()] = line
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }

  return { data, body: text.slice(match[0].length).replace(/^\n+/, ""), raw: match[0] };
}

export function serializeFrontMatter(data, body) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

export function extractMessages(text) {
  return [...text.matchAll(MESSAGE)].map((match) => ({
    index: Number(match[1]),
    entry: `<!-- export:message:${match[1]} -->\n${match[2].trim()}\n`,
  }));
}

export function mergeExports(oldText, newText, options = {}) {
  const oldDoc = parseFrontMatter(oldText);
  const newDoc = parseFrontMatter(newText);
  const now = options.now ?? new Date().toISOString();

  if (!oldDoc.data || !newDoc.data) {
    throw new Error("Both documents need YAML front matter; re-export with the current template");
  }

  if (oldDoc.data.export_id !== newDoc.data.export_id && !options.force) {
    throw new Error(
      `export_id mismatch (${oldDoc.data.export_id} vs ${newDoc.data.export_id}); pass --force to merge different sessions`,
    );
  }

  const oldMessages = extractMessages(oldDoc.body);
  const newMessages = extractMessages(newDoc.body);

  if (oldMessages.length === 0 || newMessages.length === 0) {
    throw new Error("Both documents need <!-- export:message:N --> markers");
  }
  if (!REGION.test(newDoc.body)) {
    throw new Error("New document is missing <!-- export:messages:start/end --> markers");
  }

  const oldLast = Math.max(...oldMessages.map((message) => message.index));
  const newLast = Math.max(...newMessages.map((message) => message.index));
  const added = newMessages.filter((message) => message.index > oldLast);
  const entries = [...oldMessages.map((message) => message.entry), ...added.map((message) => message.entry)];

  let body = newDoc.body.replace(
    REGION,
    `<!-- export:messages:start -->\n${entries.join("\n")}\n<!-- export:messages:end -->`,
  );

  const manual = new Map(
    [...oldDoc.body.matchAll(MANUAL)].map((match) => [match[1], match[2]]),
  );
  let preservedManual = 0;
  body = body.replace(MANUAL, (whole, id, content) => {
    if (!manual.has(id)) return whole;
    preservedManual += 1;
    return `<!-- export:manual:${id}:start -->${manual.get(id)}<!-- export:manual:${id}:end -->`;
  });

  const data = {
    ...newDoc.data,
    last_message: String(Math.max(oldLast, newLast)),
    updated_at: now,
    merge_count: String(Number(newDoc.data.merge_count ?? 0) + 1),
  };

  return {
    text: serializeFrontMatter(data, body),
    added: added.length,
    preservedManual,
    oldLast,
    newLast,
    lastMessage: Math.max(oldLast, newLast),
  };
}

function parseArgs(argv) {
  const options = {
    existing: null,
    next: null,
    out: null,
    force: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const result = argv[++index];
      if (!result) throw new Error(`${arg} requires a value`);
      return result;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--existing" || arg.startsWith("--existing=")) options.existing = arg.includes("=") ? arg.slice("--existing=".length) : value();
    else if (arg === "--new" || arg.startsWith("--new=")) options.next = arg.includes("=") ? arg.slice("--new=".length) : value();
    else if (arg === "--out" || arg.startsWith("--out=")) options.out = arg.includes("=") ? arg.slice("--out=".length) : value();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const usage =
    "Usage: node merge-export.mjs --existing old.md --new new.md --out merged.md [--force] [--dry-run] [--json]";
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(1);
  }

  if (options.help || !options.existing || !options.next || !options.out) {
    console.log(usage);
    process.exit(options.help ? 0 : 1);
  }

  let result;
  try {
    result = mergeExports(
      readFileSync(options.existing, "utf8"),
      readFileSync(options.next, "utf8"),
      { force: options.force },
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (!options.dryRun) writeFileSync(options.out, result.text);

  const report = {
    existing: basename(options.existing),
    next: basename(options.next),
    out: basename(options.out),
    addedMessages: result.added,
    preservedManualBlocks: result.preservedManual,
    lastMessage: result.lastMessage,
    dryRun: options.dryRun,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `${options.dryRun ? "Would merge" : "Merged"}: +${result.added} message(s), ${result.preservedManual} manual block(s) preserved, last message ${result.lastMessage}`,
    );
  }
}

const self = basename(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? basename(process.argv[1]) : "";
if (invoked && decodeURIComponent(self) === invoked) {
  main();
}
