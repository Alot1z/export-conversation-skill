import test from "node:test";
import assert from "node:assert/strict";
import {
  branchPath,
  conversationIdentity,
  mergeDuplicateRecords,
  pairToolEvents,
  reconstructTree,
  resolveActiveTip,
} from "../core/reconstruct.mjs";
import { makeRecord } from "../core/canonical.mjs";

const nodes = {
  root: { id: "root", parent: null },
  u: { id: "u", parent: "root" },
  a: { id: "a", parent: "u" },
  alt: { id: "alt", parent: "u" },
};

test("branch paths follow parents from root to tip", () => {
  assert.deepEqual(branchPath(nodes, "a").map((node) => node.id), ["root", "u", "a"]);
  assert.equal(resolveActiveTip(nodes, "a"), "a");
  assert.equal(resolveActiveTip(nodes, null), "alt");
});

test("tree reconstruction names the active path and every alternative", () => {
  const tree = reconstructTree(nodes, { activeNode: "a" });
  assert.equal(tree.tip, "a");
  assert.deepEqual([...tree.activeIds], ["root", "u", "a"]);
  assert.deepEqual(tree.alternatives.map((node) => node.id), ["alt"]);
});

test("tool pairing distinguishes complete, missing and orphan results", () => {
  const pairs = pairToolEvents([
    { id: "1", type: "tool_call", toolCallId: "a" },
    { id: "2", type: "tool_result", toolCallId: "a" },
    { id: "3", type: "tool_call", toolCallId: "b" },
    { id: "4", type: "tool_result", toolCallId: "c" },
  ]);
  assert.deepEqual(
    pairs.map((pair) => [pair.callId, pair.status]),
    [
      ["a", "complete"],
      ["b", "missing_result"],
      ["c", "orphan_result"],
    ],
  );
});

test("conversation identity is stable for the same source", () => {
  const first = conversationIdentity({ adapter: "x", sourceRef: "file", firstRecord: "hash", title: "T" });
  const second = conversationIdentity({ title: "T", firstRecord: "hash", sourceRef: "file", adapter: "x" });
  const other = conversationIdentity({ adapter: "x", sourceRef: "other", firstRecord: "hash", title: "T" });
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("duplicate records keep the strongest provenance and list occurrences", () => {
  const merged = mergeDuplicateRecords([
    makeRecord({ seq: 0, role: "user", content: "same", provenance: "RECONSTRUCTED", sourceRef: "legacy" }),
    makeRecord({ seq: 1, role: "user", content: "same", provenance: "ORIGINAL", sourceRef: "native" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provenance, "ORIGINAL");
  assert.equal(merged[0].occurrences, 2);
  assert.deepEqual(merged[0].sources, ["legacy", "native"]);
});
