import test from "node:test";
import assert from "node:assert/strict";
import { compareViews, dedupeViews, searchProject } from "../core/query.mjs";
import { readConversation } from "../core/store.mjs";
import { project, saveSample } from "./helpers/harness.mjs";

test("search filters by text, role and conversation", (t) => {
  const root = project(t, "query-search");
  saveSample(root, {
    conversation: { id: "alpha", title: "Alpha" },
    messages: [
      { role: "user", content: "find the needle here" },
      { role: "assistant", content: "needle answer" },
    ],
  });
  saveSample(root, {
    conversation: { id: "beta", title: "Beta" },
    messages: [{ role: "user", content: "unrelated" }],
  });
  const hits = searchProject(root, { text: "needle" });
  assert.equal(hits.hits.length, 2);
  assert.ok(hits.hits.every((hit) => hit.conversation_id === "alpha"));
  const assistant = searchProject(root, { text: "needle", role: "assistant" });
  assert.equal(assistant.hits.length, 1);
  assert.equal(assistant.hits[0].role, "assistant");
  assert.match(assistant.hits[0].snippet, /needle/);
});

test("compareViews reports added, removed, changed and unchanged records", (t) => {
  const root = project(t, "query-compare");
  saveSample(root, {
    conversation: { id: "alpha", title: "Alpha" },
    messages: [{ role: "user", content: "first" }],
  });
  const first = readConversation(root, "alpha").view;
  assert.equal(compareViews(first, first).same, true);
  const changed = structuredClone(first);
  changed.records[0].content = "changed";
  changed.records[0].hash = "different";
  changed.records.push({ ...changed.records[1], id: "extra", seq: 2 });
  const result = compareViews(first, changed);
  assert.equal(result.changed.length, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.same, false);
});

test("dedupeViews groups repeated content across conversations", (t) => {
  const root = project(t, "query-dedupe");
  saveSample(root, {
    conversation: { id: "one", title: "One" },
    messages: [{ role: "assistant", content: "same answer" }],
  });
  saveSample(root, {
    conversation: { id: "two", title: "Two" },
    messages: [{ role: "assistant", content: "same answer" }],
  });
  const views = ["one", "two"].map((id) => readConversation(root, id).view);
  const groups = dedupeViews(views);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].conversations, ["one", "two"]);
});
