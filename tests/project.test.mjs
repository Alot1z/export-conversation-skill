import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  buildIndex,
  filterExportMessages,
  resolveProjectDestination,
  validateProjectMetadata,
} from "../skills/export/scripts/project-export.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, "skills/export/scripts/project-export.mjs");

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
}

function json(result) {
  return JSON.parse(result.stdout);
}

function fixture({ id = "fixture", messages = 2, manual = "old manual note", summary = "Project work." } = {}) {
  const entries = Array.from({ length: messages }, (_, index) => {
    const role = index % 2 === 0 ? "User" : "Assistant";
    return `<!-- export:message:${index + 1} -->\n### ${index + 1} ${role}\n\nMessage ${index + 1} about export-conversation-skill-fork.\n`;
  }).join("\n");
  return `---
export_id: ${id}
session: fixture-session
last_message: ${messages}
generated_at: 2026-11-21T00:00:00Z
generator: export-conversation 2.2.1
coverage: full
---

# Conversation Export

**Exported:** 2026-11-21T00:00:00Z
**Working Directory:** /tmp/fixture
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

- **Messages:** ${messages}
<!-- export:generated:stats:end -->

<!-- export:generated:files:start -->
## Files Changed

- None.
<!-- export:generated:files:end -->
`;
}

function tempProject() {
  return mkdtempSync(join(tmpdir(), "export-project-"));
}

function writeFixture(project, name, options) {
  const path = join(project, name);
  writeFileSync(path, fixture(options));
  return path;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("resolve prefers an explicit destination over cwd", () => {
  const project = tempProject();
  const cwd = mkdtempSync(join(tmpdir(), "export-cwd-"));
  mkdirSync(join(cwd, "nested"), { recursive: true });
  const result = run(["resolve", "--destination", project, "--cwd", cwd, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = json(result);
  assert.equal(report.project_root, project);
  assert.equal(report.resolution, "explicit-destination");
});

test("resolve detects the nearest project marker without selecting a temporary cwd", () => {
  const project = tempProject();
  writeFileSync(join(project, "package.json"), "{}");
  const nested = join(project, "src", "deep");
  mkdirSync(nested, { recursive: true });
  const result = run(["resolve", "--cwd", nested, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(json(result).project_root, project);
  assert.equal(json(result).resolution, "project-marker");
});

test("resolve refuses to guess when no project root exists", () => {
  const cwd = mkdtempSync(join(tmpdir(), "export-empty-"));
  const result = run(["resolve", "--cwd", cwd, "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /refusing to guess/i);
});

test("focused add writes only inside .export and does not initialise an archive", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md");
  writeFileSync(join(project, "KEEP.md"), "keep");
  const result = run([
    "add",
    "--destination",
    project,
    "--source",
    source,
    "--conversation-id",
    "conv-focus",
    "--now",
    "2026-11-21T00:00:00Z",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = json(result);
  assert.equal(report.mode, "focused");
  assert.ok(existsSync(join(project, ".export/conversations/conv-focus/export.md")));
  assert.ok(existsSync(join(project, ".export/conversations/conv-focus/metadata.json")));
  assert.ok(!existsSync(join(project, ".export/project.json")));
  assert.ok(!existsSync(join(project, ".export/index.md")));
  assert.equal(readFileSync(join(project, "KEEP.md"), "utf8"), "keep");
});

test("archive add keeps two conversations separate and builds a deterministic index", () => {
  const project = tempProject();
  const first = writeFixture(project, "first.md", { id: "first", messages: 1 });
  const second = writeFixture(project, "second.md", { id: "second", messages: 2 });
  for (const [source, id] of [[first, "conv-first"], [second, "conv-second"]]) {
    const result = run([
      "add",
      "--destination",
      project,
      "--source",
      source,
      "--archive",
      "--conversation-id",
      id,
      "--title",
      id,
      "--now",
      "2026-11-21T00:00:00Z",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  }

  assert.ok(existsSync(join(project, ".export/project.json")));
  const index = readFileSync(join(project, ".export/index.md"), "utf8");
  assert.match(index, /conv-first/);
  assert.match(index, /conv-second/);
  assert.equal(readFileSync(join(project, ".export/conversations/conv-first/export.md"), "utf8").includes("Message 2"), false);
  assert.equal(readFileSync(join(project, ".export/conversations/conv-second/export.md"), "utf8").includes("Message 2"), true);

  const before = index;
  const init = run([
    "init",
    "--destination",
    project,
    "--now",
    "2026-11-22T00:00:00Z",
    "--json",
  ]);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(readFileSync(join(project, ".export/index.md"), "utf8"), before);
});

test("update merges only the same conversation, preserves old manual notes and increments revision", () => {
  const project = tempProject();
  const first = writeFixture(project, "first.md", { id: "first", messages: 2, manual: "manual from old" });
  const second = writeFixture(project, "second.md", { id: "second", messages: 2 });
  for (const [source, id] of [[first, "conv-first"], [second, "conv-second"]]) {
    const added = run([
      "add", "--destination", project, "--source", source, "--archive",
      "--conversation-id", id, "--now", "2026-11-21T00:00:00Z", "--json",
    ]);
    assert.equal(added.status, 0, added.stderr);
  }
  const otherBefore = digest(join(project, ".export/conversations/conv-second/export.md"));
  const update = writeFixture(project, "update.md", { id: "first", messages: 3, manual: "manual from new" });
  const result = run([
    "add", "--destination", project, "--source", update, "--update",
    "--conversation-id", "conv-first", "--now", "2026-11-22T00:00:00Z", "--json",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = json(result);
  assert.equal(report.revision, 2);
  assert.equal(report.last_message, 3);
  const merged = readFileSync(join(project, ".export/conversations/conv-first/export.md"), "utf8");
  assert.match(merged, /manual from old/);
  assert.doesNotMatch(merged, /manual from new/);
  assert.match(merged, /<!-- export:message:3 -->/);
  assert.equal(digest(join(project, ".export/conversations/conv-second/export.md")), otherBefore);
});

test("update preserves conversation metadata and scope unless explicitly overridden", () => {
  const project = tempProject();
  const first = writeFixture(project, "first.md", { id: "metadata", messages: 2 });
  const metadataPath = join(project, ".export/conversations/conv-metadata/metadata.json");
  const added = run([
    "add", "--destination", project, "--source", first, "--archive",
    "--conversation-id", "conv-metadata", "--title", "Original subject",
    "--coverage", "partial (messages 1-2 selected)", "--scope", "Export Conversation Skill Fork",
    "--filter", "agent-selected messages", "--include", "messages 1-2 of 10",
    "--exclude", "unrelated projects", "--history-gaps", "older history unavailable",
    "--tags", "project,export", "--now", "2026-11-21T00:00:00Z", "--json",
  ]);
  assert.equal(added.status, 0, added.stderr + added.stdout);
  const before = JSON.parse(readFileSync(metadataPath, "utf8"));

  const update = writeFixture(project, "update.md", { id: "metadata", messages: 3 });
  const updated = run([
    "add", "--destination", project, "--source", update, "--update",
    "--conversation-id", "conv-metadata", "--now", "2026-11-22T00:00:00Z", "--json",
  ]);
  assert.equal(updated.status, 0, updated.stderr + updated.stdout);
  const after = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(after.conversation.title, "Original subject");
  assert.deepEqual(after.conversation.tags, ["project", "export"]);
  assert.equal(after.conversation.coverage, "partial (messages 1-2 selected)");
  assert.equal(after.scope.mode, "archive");
  assert.equal(after.scope.project, "Export Conversation Skill Fork");
  assert.equal(after.scope.filter, "agent-selected messages");
  assert.equal(after.scope.included_messages, "messages 1-2 of 10");
  assert.equal(after.scope.excluded, "unrelated projects");
  assert.equal(after.scope.history_gaps, "older history unavailable");
  assert.equal(after.conversation.status, "active");
  assert.notEqual(after.export.sha256, before.export.sha256);

  const overrideSource = writeFixture(project, "override.md", { id: "metadata", messages: 4 });
  const overridden = run([
    "add", "--destination", project, "--source", overrideSource, "--update",
    "--conversation-id", "conv-metadata", "--title", "New subject",
    "--coverage", "partial (new selection)", "--scope", "New scope",
    "--filter", "manual selection", "--include", "messages 1-4",
    "--exclude", "none", "--history-gaps", "none",
    "--tags", "updated", "--now", "2026-11-23T00:00:00Z", "--json",
  ]);
  assert.equal(overridden.status, 0, overridden.stderr + overridden.stdout);
  const overrides = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(overrides.conversation.title, "New subject");
  assert.deepEqual(overrides.conversation.tags, ["updated"]);
  assert.equal(overrides.conversation.coverage, "partial (new selection)");
  assert.equal(overrides.scope.project, "New scope");
  assert.equal(overrides.scope.filter, "manual selection");
  assert.equal(overrides.scope.included_messages, "messages 1-4");
  assert.equal(overrides.scope.excluded, "none");
  assert.equal(overrides.scope.history_gaps, "none");
});

test("add refuses to overwrite an existing conversation without --update", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md", { id: "same" });
  const args = ["add", "--destination", project, "--source", source, "--conversation-id", "conv-same", "--json"];
  assert.equal(run(args).status, 0);
  const again = run(args);
  assert.equal(again.status, 1);
  assert.match(again.stdout + again.stderr, /already exists.*--update/i);
});

test("conversation ids reject traversal", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md", { id: "escape" });
  const result = run([
    "add", "--destination", project, "--source", source,
    "--conversation-id", "../outside", "--json",
  ]);
  assert.equal(result.status, 1);
  assert.ok(!existsSync(join(project, "outside")));
});

test("filter selects messages, renumbers markers and states partial coverage", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md", { id: "filter-me", messages: 4 });
  const sourceBefore = digest(source);
  const out = join(project, "focused.md");
  const result = run([
    "filter", "--source", source, "--messages", "1,3", "--out", out, "--project", "export-conversation-skill-fork", "--json",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(digest(source), sourceBefore);
  const text = readFileSync(out, "utf8");
  assert.match(text, /last_message: 2/);
  assert.match(text, /coverage: partial/);
  assert.match(text, /Message 1 about/);
  assert.match(text, /Message 3 about/);
  assert.doesNotMatch(text, /Message 2 about/);
  assert.doesNotMatch(text, /Message 4 about/);
  assert.equal(text.includes("<!-- export:message:1 -->"), true);
  assert.equal(text.includes("<!-- export:message:2 -->"), true);
  assert.equal(text.includes("<!-- export:message:3 -->"), false);
});

test("a symlinked .export that escapes the project is refused", () => {
  const base = mkdtempSync(join(tmpdir(), "export-symlink-"));
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const source = join(base, "source.md");
  writeFileSync(source, fixture({ id: "symlink" }));
  try {
    symlinkSync(outside, join(project, ".export"), "junction");
    const result = run(["add", "--destination", project, "--source", source, "--json"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /escapes the project root/i);
    assert.equal(existsSync(join(outside, "conversations")), false);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EEXIST") throw error;
  }
});

test("verify detects a tampered export hash", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md", { id: "verify" });
  assert.equal(run(["add", "--destination", project, "--source", source, "--conversation-id", "conv-verify", "--json"]).status, 0);
  assert.equal(run(["verify", "--destination", project, "--json"]).status, 0);
  writeFileSync(join(project, ".export/conversations/conv-verify/export.md"), "tampered");
  const result = run(["verify", "--destination", project, "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /hash does not match/i);
});

test("archive preserves content and overview does not modify source exports", () => {
  const project = tempProject();
  const source = writeFixture(project, "source.md", { id: "archive" });
  assert.equal(run(["add", "--destination", project, "--source", source, "--archive", "--conversation-id", "conv-archive", "--json"]).status, 0);
  const exportPath = join(project, ".export/conversations/conv-archive/export.md");
  const before = digest(exportPath);
  const result = run(["archive", "--destination", project, "--conversation-id", "conv-archive", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(digest(exportPath), before);
  const metadata = JSON.parse(readFileSync(join(project, ".export/conversations/conv-archive/metadata.json"), "utf8"));
  assert.equal(metadata.conversation.status, "archived");

  const overview = run(["overview", "--destination", project, "--out", "overview.md", "--json"]);
  assert.equal(overview.status, 0, overview.stderr);
  assert.ok(existsSync(join(project, ".export/overview.md")));
  assert.equal(digest(exportPath), before);
});

test("metadata schema rejects a missing digest and index rows are deterministic", () => {
  const check = validateProjectMetadata({
    schema_version: 1,
    project: { id: "proj-abcdef", name: "P" },
    conversation: {
      id: "conv-a", title: "A", coverage: "full", status: "active",
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    },
    export: { file: "export.md", revision: 1, sha256: "bad", bytes: 1, last_message: 1 },
    scope: { mode: "focused", filter: "agent-selected", included_messages: "all" },
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((error) => error.includes("sha256")));

  const base = {
    schema_version: 1,
    project_id: "proj-abcdef",
    name: "P",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    conversation_count: 2,
    export_version: "2.2.1",
  };
  const metas = [
    { conversation: { id: "conv-b", title: "B", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", coverage: "full", status: "active" }, export: { file: "export.md", revision: 1 } },
    { conversation: { id: "conv-a", title: "A", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", coverage: "full", status: "active" }, export: { file: "export.md", revision: 1 } },
  ];
  assert.equal(buildIndex(base, metas), buildIndex(base, [...metas].reverse()));
});
