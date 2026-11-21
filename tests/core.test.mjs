import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeSvg,
  extractBlocks,
  lintBlock,
  parseArgs,
  quoteFor,
  resolveRenderer,
  VERSION,
} from "../skills/export/scripts/render-mermaid.mjs";
import { redactText, scanSecrets } from "../skills/export/scripts/redact.mjs";
import { extractMessages, mergeExports, parseFrontMatter } from "../skills/export/scripts/merge-export.mjs";
import { validateExport } from "../skills/export/scripts/validate-export.mjs";
import { rewriteAssets } from "../skills/export/scripts/assets.mjs";

const FRONT_MATTER = `---
export_id: fixture
session: test
last_message: 1
generated_at: 2026-11-21T00:00:00Z
generator: export-conversation ${VERSION}
coverage: full
---
`;

function document({ messages = 1, summary = "Summary", manual = "note", extra = "" } = {}) {
  const entries = Array.from({ length: messages }, (_, index) =>
    `<!-- export:message:${index + 1} -->\n### ${index + 1} User\n\nmessage ${index + 1}\n`,
  ).join("\n");

  return `${FRONT_MATTER}
# Conversation Export

**Coverage:** full

<!-- export:generated:summary:start -->
## Conversation Summary

${summary}
<!-- export:generated:summary:end -->

<!-- export:manual:notes:start -->
${manual}
<!-- export:manual:notes:end -->

<!-- export:generated:visual:start -->
## Visual Overview

No diagrams.
<!-- export:generated:visual:end -->

## Full Conversation

<!-- export:messages:start -->
${entries}
<!-- export:messages:end -->

<!-- export:generated:stats:start -->
## Session Statistics

- Messages: ${messages}
<!-- export:generated:stats:end -->

<!-- export:generated:files:start -->
## Files Changed

None.
<!-- export:generated:files:end -->
${extra}`;
}

test("quoteFor quotes spaces and quotes for both shells", () => {
  assert.equal(quoteFor("plain", true), "plain");
  assert.equal(quoteFor("a b", true), '"a b"');
  assert.equal(quoteFor('a"b', true), '"a""b"');
  assert.equal(quoteFor("a b", false), "'a b'");
  assert.equal(quoteFor("a'b", false), "'a'\\''b'");
});

test("extractBlocks handles CRLF and records line numbers", () => {
  const source = "# x\r\n```mermaid\r\nflowchart LR\r\n  A --> B\r\n```\r\n";
  const [block] = extractBlocks(source);
  assert.equal(block.index, 1);
  assert.equal(block.line, 2);
  assert.match(block.body, /^flowchart LR/);
});

test("lintBlock flags unknown types, graph and empty labels", () => {
  assert.deepEqual(lintBlock("flowchart LR\n A --> B").warnings, []);
  assert.ok(lintBlock("unknownThing\n A --> B").warnings.some((warning) => warning.includes("unknown")));
  assert.ok(lintBlock("graph TD\n A --> B").warnings.some((warning) => warning.includes("flowchart")));
  assert.ok(lintBlock("flowchart LR\n A[]").warnings.some((warning) => warning.includes("empty")));
});

test("analyzeSvg reports dimensions, aspect and missing text", () => {
  const info = analyzeSvg('<svg viewBox="0 0 2000 100"><rect/></svg>');
  assert.equal(info.width, 2000);
  assert.equal(info.height, 100);
  assert.equal(info.aspect, 20);
  assert.ok(info.warnings.some((warning) => warning.includes("aspect")));
  assert.ok(info.warnings.some((warning) => warning.includes("text")));
});

test("parseArgs handles values and rejects unknown options", () => {
  const options = parseArgs(["docs/export.md", "--out", "tmp/out", "--jobs=2", "--strict-layout"]);
  assert.equal(options.file, "docs/export.md");
  assert.equal(options.outDir, "tmp/out");
  assert.equal(options.jobs, 2);
  assert.equal(options.strictLayout, true);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
});

test("resolveRenderer honours --offline without a local binary", () => {
  const empty = mkdtempSync(join(tmpdir(), "export-renderer-"));
  assert.throws(() => resolveRenderer({ offline: true, mmdc: null }, empty), /No local mmdc/);
  const renderer = resolveRenderer({ offline: false, mmdc: null }, empty);
  assert.match(renderer.label, /npx/);
});

test("redactText removes common secrets without leaking values", () => {
  const source = [
    "key: sk-abcdefghijklmnopqrstuvwx",
    "password: hunter2hunter2",
    "safe: process.env.API_KEY",
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEow",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");

  const findings = scanSecrets(source);
  assert.ok(findings.some((finding) => finding.type === "openai-key"));
  assert.ok(findings.some((finding) => finding.type === "credential-assignment"));
  assert.ok(findings.some((finding) => finding.type === "private-key"));

  const redacted = redactText(source);
  assert.ok(!redacted.text.includes("sk-abcdefghijklmnopqrstuvwx"));
  assert.ok(!redacted.text.includes("hunter2hunter2"));
  assert.ok(redacted.text.includes("process.env.API_KEY"));
  assert.ok(redacted.text.includes("[REDACTED"));
});

test("parseFrontMatter and message extraction are stable", () => {
  const doc = parseFrontMatter(document({ messages: 2 }));
  assert.equal(doc.data.export_id, "fixture");
  assert.equal(doc.data.last_message, "1");
  assert.equal(extractMessages(doc.body).length, 2);
});

test("mergeExports appends only new messages and preserves manual blocks", () => {
  const oldText = document({ messages: 2, summary: "old summary", manual: "old notes" });
  const newText = document({ messages: 4, summary: "new summary", manual: "new notes" });
  const result = mergeExports(oldText, newText);

  assert.equal(result.added, 2);
  assert.equal(result.preservedManual, 1);
  assert.equal(result.lastMessage, 4);
  assert.match(result.text, /new summary/);
  assert.match(result.text, /old notes/);
  assert.doesNotMatch(result.text, /new notes/);
  assert.equal(extractMessages(result.text).length, 4);
  assert.equal(new Set(extractMessages(result.text).map((message) => message.index)).size, 4);
  assert.match(result.text, /last_message: 4/);
});

test("mergeExports refuses mismatched export ids unless forced", () => {
  const oldText = document({ messages: 1 });
  const newText = document({ messages: 2 }).replace("export_id: fixture", "export_id: other");
  assert.throws(() => mergeExports(oldText, newText), /export_id mismatch/);
  assert.equal(mergeExports(oldText, newText, { force: true }).lastMessage, 2);
});

test("validateExport accepts a complete document", () => {
  const result = validateExport(document({ messages: 2 }).replace("last_message: 1", "last_message: 2"));
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("validateExport rejects missing structure and secrets", () => {
  const result = validateExport("# Broken\n\nkey: sk-abcdefghijklmnopqrstuvwx");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("front matter")));
  assert.ok(result.errors.some((error) => error.includes("secret")));
});

test("rewriteAssets copies local images and rewrites links", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-assets-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "diagram-one.png"), "image");
  writeFileSync(join(dir, "doc.md"), "![ ](diagram-one.png)");

  const result = rewriteAssets(readFileSync(join(dir, "doc.md"), "utf8"), join(dir, "doc.md"));
  writeFileSync(join(dir, "doc.md"), result.text);

  assert.equal(result.copied.length, 1);
  assert.match(result.text, /!\[diagram one\]\(doc-assets\/diagram-one\.png\)/);
  assert.ok(existsSync(join(dir, "doc-assets", "diagram-one.png")));
});
