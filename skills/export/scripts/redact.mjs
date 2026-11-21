#!/usr/bin/env node
/**
 * Scan or redact secrets in a conversation export.
 *
 * Usage:
 *   node redact.mjs <file.md> [--write] [--json] [--emails] [--paths]
 *
 * Default is check mode: report finding types and line numbers, never values,
 * and exit 1 when anything is found. --write rewrites matches to [REDACTED].
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export const VERSION = "2.2.0";

const PATTERNS = [
  {
    type: "private-key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { type: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: "aws-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/g },
  { type: "credential-url", regex: /:\/\/[^/\s:@]+:[^/\s@]+@/g },
];

const ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|pwd)\b\s*[:=]\s*(["']?)([^\s"'`]{8,})\2/gi;

const PLACEHOLDER = /^(process\.env|\$\{|\$[A-Z_]|<[^>]+>|your[_-]|example|changeme|placeholder|\*+|x{4,}|\[REDACTED\])/i;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const WINDOWS_HOME = /\b[A-Za-z]:\\Users\\[^\\\s]+/g;
const UNIX_HOME = /\/(?:home|Users)\/[^/\s]+/g;

function isPlaceholder(value) {
  return PLACEHOLDER.test(value.trim());
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function privateKeyFindings(text) {
  const findings = [];
  const regex = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
  for (const match of text.matchAll(regex)) {
    findings.push({ line: lineNumberAt(text, match.index), type: "private-key" });
  }
  return findings;
}

function lineFindings(line, options) {
  const types = new Set();

  for (const pattern of PATTERNS) {
    if (pattern.type === "private-key") continue;
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(line)) types.add(pattern.type);
  }

  ASSIGNMENT.lastIndex = 0;
  for (const match of line.matchAll(ASSIGNMENT)) {
    if (!isPlaceholder(match[3])) types.add("credential-assignment");
  }

  if (options.emails) {
    EMAIL.lastIndex = 0;
    if (EMAIL.test(line)) types.add("email");
  }

  if (options.paths) {
    WINDOWS_HOME.lastIndex = 0;
    UNIX_HOME.lastIndex = 0;
    if (WINDOWS_HOME.test(line) || UNIX_HOME.test(line)) types.add("home-path");
  }

  return [...types];
}

export function scanSecrets(text, options = {}) {
  const findings = [...privateKeyFindings(text)];

  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes("[REDACTED]")) return;
    for (const type of lineFindings(line, options)) {
      findings.push({ line: index + 1, type });
    }
  });

  findings.sort((left, right) => left.line - right.line || left.type.localeCompare(right.type));
  return findings;
}

function redactLine(line, options) {
  let next = line;

  for (const pattern of PATTERNS) {
    if (pattern.type === "private-key") continue;
    pattern.regex.lastIndex = 0;
    next = next.replace(pattern.regex, "[REDACTED]");
  }

  ASSIGNMENT.lastIndex = 0;
  next = next.replace(ASSIGNMENT, (match, key, quoteMark, value) =>
    isPlaceholder(value) ? match : `${key}: [REDACTED]`,
  );

  if (options.emails) {
    next = next.replace(EMAIL, "[REDACTED_EMAIL]");
  }

  if (options.paths) {
    next = next.replace(WINDOWS_HOME, "%USERPROFILE%").replace(UNIX_HOME, "~");
  }

  return next;
}

export function redactText(text, options = {}) {
  let output = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  );
  output = output
    .split(/\r?\n/)
    .map((line) => (line.includes("[REDACTED") ? line : redactLine(line, options)))
    .join("\n");
  return { text: output, findings: scanSecrets(text, options) };
}

function parseArgs(argv) {
  const options = { file: null, write: false, json: false, emails: false, paths: false, help: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--write") options.write = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--emails") options.emails = true;
    else if (arg === "--paths") options.paths = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Pass one Markdown file at a time");
    else options.file = arg;
  }
  return options;
}

function main() {
  const usage = "Usage: node redact.mjs <file.md> [--write] [--json] [--emails] [--paths]";
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

  let source;
  try {
    source = readFileSync(options.file, "utf8");
  } catch (error) {
    console.error(`Cannot read ${options.file}: ${error.message}`);
    process.exit(1);
  }

  const findings = scanSecrets(source, options);

  if (options.write) {
    const redacted = redactText(source, options);
    writeFileSync(options.file, redacted.text);
  }

  const report = {
    file: basename(options.file),
    mode: options.write ? "write" : "check",
    count: findings.length,
    findings,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (findings.length === 0) {
    console.log(`No secrets found in ${options.file}`);
  } else {
    console.log(`${findings.length} finding(s) in ${options.file}:`);
    for (const finding of findings) console.log(`  line ${finding.line}: ${finding.type}`);
    if (options.write) console.log("Rewrote matched values as [REDACTED].");
    else console.log("Run with --write to redact, or review manually.");
  }

  process.exit(!options.write && findings.length > 0 ? 1 : 0);
}

const self = basename(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? basename(process.argv[1]) : "";
if (invoked && decodeURIComponent(self) === invoked) {
  main();
}
