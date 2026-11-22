import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildView } from "../core/canonical.mjs";
import { applyCoverage } from "../core/coverage.mjs";
import { getAdapter, listAdapters, registerAdapter } from "../core/registry.mjs";
import { saveConversation } from "../core/store.mjs";
import { verifyConversation } from "../core/verify.mjs";
import { project } from "./helpers/harness.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function capture() {
  const view = buildView({
    conversation: { id: "pure-core", title: "Pure core" },
    source: {
      adapter: "pure-core",
      version: "1.0.0",
      harness: "none",
      kind: "generic-import",
      ref: "inline",
      capabilities: {
        user: true,
        assistant: true,
        system: false,
        toolCalls: false,
        toolResults: false,
        attachments: false,
        timestamps: true,
        originalIds: false,
        pagination: false,
        fullHistory: true,
      },
    },
    boundary: { kind: "inline", total_known: true, records_available: 1, history_complete: true },
    records: [{ seq: 0, role: "user", content: "core only", timestamp: "2026-01-01T00:00:00Z" }],
  });
  return applyCoverage(view, { boundary: view.boundary });
}

test("core imports no harness or adapter code", () => {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".mjs")) files.push(target);
    }
  };
  walk(path.join(ROOT, "core"));
  const forbidden = [
    /from\s+["'][^"']*adapters\//,
    /@modelcontextprotocol/,
    /from\s+["'](?:openai|@anthropic-ai|anthropic)["']/,
    /better-sqlite3/,
    /adm-zip/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${path.relative(ROOT, file)} imports a forbidden dependency`);
    }
  }
});

test("the core package has no npm runtime dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies ?? undefined, undefined);
  assert.equal(pkg.optionalDependencies ?? undefined, undefined);
});

test("an adapter built only on the contract can be registered and verified", async (t) => {
  assert.equal(listAdapters().length, 0, "this test process must not import the adapter index");
  const adapter = {
    id: "pure-core",
    version: "1.0.0",
    harness: "none",
    kind: "generic-import",
    capabilities: capture().source.capabilities,
    async capture() {
      return capture();
    },
  };
  registerAdapter(adapter);
  assert.equal(getAdapter("pure-core").id, "pure-core");
  const root = project(t, "independence");
  const view = await getAdapter("pure-core").capture();
  saveConversation(root, view, {
    conversationId: "pure-core",
    now: "2026-11-22T00:00:00.000Z",
  });
  const report = verifyConversation(root, "pure-core");
  assert.equal(report.ok, true, report.failed.join(","));
});
