#!/usr/bin/env node
/**
 * Reject commit messages that contain tool attribution or emoji.
 *
 * Usage:
 *   node tools/check-commit-policy.mjs [--range <rev>]
 *   node tools/check-commit-policy.mjs --message-file <path>
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ATTRIBUTION_RULES = [
  { name: "co-author trailer", pattern: /^\s*Co-Authored-By\s*:/i },
  { name: "generated-with attribution", pattern: /^\s*Generated with (?:Codebuff|Freebuff)\b/i },
  { name: "tool attribution", pattern: /\b(?:codebuff|freebuff)\b/i },
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

export function checkMessage(message) {
  const violations = [];
  const lines = String(message).replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, index) => {
    const attribution = ATTRIBUTION_RULES.find((rule) => rule.pattern.test(line));
    if (attribution) {
      violations.push({ line: index + 1, rule: attribution.name, text: line.trim() });
    }
    if (EMOJI.test(line)) {
      violations.push({ line: index + 1, rule: "emoji", text: line.trim() });
    }
  });

  return violations;
}

export function checkRange(range = "HEAD", cwd = process.cwd()) {
  let output;
  try {
    output = execFileSync("git", ["log", "--format=%H%x1f%B%x1e", range], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return [{ commit: range, error: error.message, violations: [] }];
  }

  const failures = [];
  for (const record of output.split("\x1e")) {
    const entry = record.trimStart();
    if (!entry) continue;
    const separator = entry.indexOf("\x1f");
    const commit = (separator === -1 ? entry : entry.slice(0, separator)).trim();
    const message = separator === -1 ? "" : entry.slice(separator + 1);
    const violations = checkMessage(message);
    if (violations.length) failures.push({ commit, violations });
  }
  return failures;
}

function report(failures) {
  let total = 0;
  for (const failure of failures) {
    if (failure.error) {
      console.error(`${failure.commit}: ${failure.error}`);
      total += 1;
      continue;
    }
    for (const violation of failure.violations) {
      console.error(`${failure.commit}:${violation.line}: ${violation.rule}: ${violation.text}`);
      total += 1;
    }
  }
  if (total) {
    console.error("Commit message policy: FAIL");
    return 1;
  }
  console.log("Commit message policy: pass");
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node tools/check-commit-policy.mjs [--range <rev>] [--message-file <path>]");
    return 0;
  }

  const messageIndex = args.indexOf("--message-file");
  if (messageIndex !== -1) {
    const path = args[messageIndex + 1];
    if (!path) {
      console.error("--message-file requires a path");
      return 2;
    }
    return report([{ commit: path, violations: checkMessage(readFileSync(path, "utf8")) }]);
  }

  const rangeIndex = args.indexOf("--range");
  const range = rangeIndex === -1 ? "HEAD" : args[rangeIndex + 1];
  if (!range) {
    console.error("--range requires a revision");
    return 2;
  }
  return report(checkRange(range));
}

process.exitCode = main();
