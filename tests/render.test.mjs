import test from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../core/canonical.mjs";
import { applyCoverage } from "../core/coverage.mjs";
import { renderMarkdown } from "../core/render/markdown.mjs";
import { renderJson, renderJsonl } from "../core/render/json.mjs";
import { renderHtml } from "../core/render/html.mjs";

function view() {
  const built = buildView({
    conversation: { id: "render", title: "Render <test>" },
    source: { adapter: "test", kind: "generic-import" },
    boundary: { kind: "file", total_known: true, records_available: 2, history_complete: false },
    records: [
      { seq: 0, role: "user", content: "hello <script>alert(1)</script>", timestamp: "2026-01-01T00:00:00Z" },
      { seq: 1, role: "unknown", type: "unknown", content: "raw evidence", unknown: true, raw: { line: 9 } },
    ],
  });
  return applyCoverage(built, { boundary: built.boundary });
}

test("Markdown rendering is deterministic and states every coverage dimension", () => {
  const first = renderMarkdown(view(), { generatedAt: "2026-11-22T00:00:00Z" });
  const second = renderMarkdown(view(), { generatedAt: "2026-11-22T00:00:00Z" });
  assert.equal(first, second);
  assert.match(first, /coverage_source: PARTIAL/);
  assert.match(first, /coverage_selection: COMPLETE/);
  assert.match(first, /coverage_export: COMPLETE/);
  assert.match(first, /UNKNOWN record/);
  assert.match(first, /Boundary: `file`/);
  assert.match(first, /complete only relative to the stated boundary/);
});

test("JSON rendering round-trips the canonical view", () => {
  const built = view();
  const parsed = JSON.parse(renderJson(built));
  assert.deepEqual(parsed, built);
  assert.equal(renderJsonl(built).trim().split("\n").length, 2);
});

test("HTML rendering escapes content and emits no script", () => {
  const html = renderHtml(view(), { generatedAt: "2026-11-22T00:00:00Z" });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /PARTIAL/);
  assert.match(html, /UNKNOWN record/);
});

test("Markdown uses a fence longer than any run in the content", () => {
  const built = buildView({
    conversation: { id: "fence" },
    source: { adapter: "test", kind: "generic-import" },
    records: [{ seq: 0, role: "tool", type: "tool_result", toolCallId: "t", content: "code ``` inside" }],
    boundary: { total_known: true, records_available: 1, history_complete: true },
  });
  applyCoverage(built, { boundary: built.boundary });
  const markdown = renderMarkdown(built, { generatedAt: "2026-11-22T00:00:00Z" });
  assert.match(markdown, /````text/);
});
