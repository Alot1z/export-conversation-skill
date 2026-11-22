#!/usr/bin/env node
/** Measure the local pipeline. Reports observations; it makes no speed claims. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import "../adapters/index.mjs";
import { getAdapter } from "../core/registry.mjs";
import { saveConversation } from "../core/store.mjs";
import { searchProject } from "../core/query.mjs";
import { verifyAll } from "../core/verify.mjs";
import { writeIndex } from "../core/service.mjs";
import { writeFixtures } from "../tests/helpers/fixtures.mjs";

function parseArgs(argv) {
  const options = { profile: "smoke" };
  for (const arg of argv) {
    if (arg.startsWith("--profile=")) options.profile = arg.slice("--profile=".length);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "export-conversation-bench-"));
const fixtures = writeFixtures(path.join(root, "fixtures"));
const cases = [
  ["claude-code", fixtures.claude],
  ["codex", fixtures.codex],
  ["gemini-cli", fixtures.gemini],
  ["chatgpt-export", fixtures.chatgpt],
  ["openhands-transcript", fixtures.openhands],
  ["freebuff-thread-context", fixtures.freebuff],
  ["generic-json", fixtures.genericJson],
  ["generic-jsonl", fixtures.genericJsonl],
];

try {
  const importStart = performance.now();
  const imported = [];
  for (const [id, input] of cases) {
    const view = await getAdapter(id).capture({
      input,
      options: { conversationId: `bench-${id}` },
    });
    const saved = saveConversation(root, view, {
      conversationId: `bench-${id}`,
      now: "2026-11-22T00:00:00.000Z",
      rendered: {},
    });
    imported.push({
      adapter: id,
      records: view.records.length,
      revision: saved.revision,
      transaction: saved.transaction,
    });
  }
  const importMs = performance.now() - importStart;

  const indexStart = performance.now();
  writeIndex(root, { now: "2026-11-22T00:00:00.000Z" });
  const indexMs = performance.now() - indexStart;

  const searchStart = performance.now();
  const search = searchProject(root, { text: "answer", limit: 50 });
  const searchMs = performance.now() - searchStart;

  const verifyStart = performance.now();
  const verification = verifyAll(root);
  const verifyMs = performance.now() - verifyStart;

  const report = {
    profile: options.profile,
    ok: verification.ok,
    conversations: imported.length,
    records: imported.reduce((total, entry) => total + entry.records, 0),
    metrics_ms: {
      import: Number(importMs.toFixed(2)),
      index: Number(indexMs.toFixed(2)),
      search: Number(searchMs.toFixed(2)),
      verify: Number(verifyMs.toFixed(2)),
    },
    hits: search.hits.length,
    failed: verification.conversations.filter((entry) => !entry.ok).map((entry) => entry.id),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!verification.ok) process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
