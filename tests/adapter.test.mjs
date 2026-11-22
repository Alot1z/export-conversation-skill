import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "../adapters/index.mjs";
import { getAdapter, listAdapters, registerAdapter } from "../core/registry.mjs";
import { validateConversation } from "../core/canonical.mjs";
import { readCatalogue } from "../core/service.mjs";
import { writeFixtures } from "./helpers/fixtures.mjs";
import { project } from "./helpers/harness.mjs";

const CASES = [
  ["claude-code", "claude"],
  ["codex", "codex"],
  ["gemini-cli", "gemini"],
  ["chatgpt-export", "chatgpt"],
  ["openhands-transcript", "openhands"],
  ["freebuff-thread-context", "freebuff"],
  ["generic-json", "genericJson"],
  ["generic-jsonl", "genericJsonl"],
];

test("every registered adapter produces a valid canonical view", async (t) => {
  const root = project(t, "adapter-all");
  const fixtures = writeFixtures(path.join(root, "fixtures"));
  for (const [id, key] of CASES) {
    const adapter = getAdapter(id);
    assert.ok(adapter, `missing adapter ${id}`);
    const view = await adapter.capture({
      input: fixtures[key],
      options: { conversationId: `c-${id}` },
    });
    const validation = validateConversation(view);
    assert.equal(validation.ok, true, `${id}: ${validation.errors.join("; ")}`);
    assert.equal(view.source.adapter, id);
    assert.ok(view.records.length > 0);
    assert.ok(["COMPLETE", "PARTIAL", "UNKNOWN", "UNAVAILABLE"].includes(view.coverage.source.status));
  }
});

test("Claude Code keeps tool pairs and non-message evidence", async (t) => {
  const root = project(t, "adapter-claude");
  const fixtures = writeFixtures(path.join(root, "fixtures"));
  const view = await getAdapter("claude-code").capture({ input: fixtures.claude });
  assert.equal(view.source.evidence, "live");
  assert.deepEqual(
    view.tool_pairs.map((pair) => [pair.callId, pair.status]),
    [["t1", "complete"]],
  );
  assert.ok(view.records.some((record) => record.type === "unknown" && record.status === "non-message"));
  assert.equal(view.coverage.source.status, "COMPLETE");
});

test("ChatGPT export uses the active branch and accounts for alternatives", async (t) => {
  const root = project(t, "adapter-chatgpt");
  const fixtures = writeFixtures(path.join(root, "fixtures"));
  const view = await getAdapter("chatgpt-export").capture({ input: fixtures.chatgpt });
  assert.deepEqual(
    view.records.map((record) => record.content),
    ["zip question", "zip answer"],
  );
  assert.ok(view.warnings.some((warning) => warning.includes("alternative")));
  assert.equal(view.attachments.length, 1);
  assert.equal(view.attachments[0].status, "unavailable");
});

test("generic JSONL preserves malformed lines as UNKNOWN", async (t) => {
  const root = project(t, "adapter-jsonl");
  const fixtures = writeFixtures(path.join(root, "fixtures"));
  const view = await getAdapter("generic-jsonl").capture({ input: fixtures.genericJsonl });
  assert.equal(view.records.length, 3);
  assert.equal(view.records.filter((record) => record.unknown).length, 1);
  assert.ok(view.warnings.length >= 1);
});

test("the catalogue and the registry describe the same adapters", () => {
  const catalogue = readCatalogue();
  const registered = listAdapters().map((adapter) => adapter.id).sort();
  const catalogued = catalogue.harnesses.map((entry) => entry.adapter).sort();
  assert.deepEqual(catalogued, registered);
  for (const entry of catalogue.harnesses) {
    assert.ok(entry.evidence, `${entry.id} needs an evidence class`);
    assert.ok(entry.limitations.length > 0);
  }
});

test("invalid and duplicate adapters are refused", () => {
  assert.throws(
    () => registerAdapter({ id: "bad", version: "1", harness: "x", kind: "nope" }),
    (error) => error.code === "INVALID_ADAPTER",
  );
  assert.throws(
    () => registerAdapter(getAdapter("generic-json")),
    (error) => error.code === "DUPLICATE_ADAPTER",
  );
});

test("adapters do not write to the project by themselves", async (t) => {
  const root = project(t, "adapter-readonly");
  const fixtures = writeFixtures(path.join(root, "fixtures"));
  await getAdapter("claude-code").capture({ input: fixtures.claude });
  assert.equal(fs.existsSync(path.join(root, ".export")), false);
});
