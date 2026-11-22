#!/usr/bin/env node
/**
 * Turn a failed `node --test` log into GitHub check annotations.
 *
 * GitHub only exposes job logs to repository admins, so the cross-platform
 * workflow writes the failing lines as annotations that remain readable
 * through the check-runs API.
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node tools/ci-annotate.mjs <test-output.log>");
  process.exit(2);
}

const text = readFileSync(path, "utf8");
const lines = text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^(?:✖|not ok)|AssertionError|Error:/.test(line))
  .slice(0, 25);

for (const line of lines) {
  const message = line
    .replaceAll("%", "%25")
    .replaceAll("\r", "")
    .replaceAll("\n", "%0A")
    .slice(0, 900);
  console.log(`::error title=Test failure::${message}`);
}

process.exit(1);
