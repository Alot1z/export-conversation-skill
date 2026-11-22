/**
 * Timeline and branch reconstruction.
 *
 * Tree-shaped sources (ChatGPT exports, forked Claude Code sessions) keep the
 * active path and record every alternative tip. Nothing is flattened silently.
 */

import { buildView, hashObject, sha256 } from "./canonical.mjs";

export function branchPath(nodes, tipId) {
  const path = [];
  const seen = new Set();
  let cursor = tipId;
  while (cursor && nodes[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(nodes[cursor]);
    cursor = nodes[cursor].parent ?? null;
  }
  return path.reverse();
}

export function resolveActiveTip(nodes, preferredTip) {
  if (preferredTip && nodes[preferredTip]) return preferredTip;
  const tips = Object.values(nodes).filter(
    (node) => !Object.values(nodes).some((candidate) => candidate.parent === node.id),
  );
  tips.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return tips.at(-1)?.id ?? null;
}

export function reconstructTree(nodes, options = {}) {
  const tip = resolveActiveTip(nodes, options.activeNode);
  const activePath = branchPath(nodes, tip);
  const activeIds = new Set(activePath.map((node) => node.id));
  const alternatives = Object.values(nodes)
    .filter((node) => !activeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      parentId: node.parent ?? null,
      preview: String(node.message?.content?.parts ?? node.message?.content ?? "").slice(0, 120),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { tip, activePath, activeIds, alternatives, branchId: options.branchId ?? "main" };
}

export function pairToolEvents(records) {
  const calls = new Map();
  const results = new Map();
  for (const record of records) {
    if (record.type === "tool_call" && record.toolCallId) calls.set(record.toolCallId, record);
    if (record.type === "tool_result" && record.toolCallId) results.set(record.toolCallId, record);
  }
  return [...new Set([...calls.keys(), ...results.keys()])].sort().map((callId) => {
    const call = calls.get(callId) ?? null;
    const result = results.get(callId) ?? null;
    return {
      callId,
      status: call && result ? "complete" : call ? "missing_result" : "orphan_result",
      callIdRecord: call?.id ?? null,
      resultId: result?.id ?? null,
    };
  });
}

/**
 * Stable identity for re-import: depends on the source and the first record,
 * never on capture time, so importing the same source twice keeps one id.
 */
export function conversationIdentity(input = {}) {
  return `conv-${hashObject({
    adapter: input.adapter ?? "generic",
    sourceRef: input.sourceRef ?? null,
    firstRecord: input.firstRecord ?? null,
    title: input.title ?? null,
  }).slice(0, 20)}`;
}

export function mergeDuplicateRecords(records) {
  const priority = {
    ORIGINAL: 0,
    IMPORTED: 1,
    RECONSTRUCTED: 2,
    DERIVED: 3,
    TRANSFORMED: 4,
    SUMMARISED: 5,
    REDACTED: 6,
    UNKNOWN: 7,
  };
  const groups = new Map();
  for (const record of records) {
    const key = hashObject({ role: record.role, content: record.content, type: record.type });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort(
        (left, right) =>
          (priority[left.provenance] ?? 99) - (priority[right.provenance] ?? 99) ||
          String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")) ||
          left.id.localeCompare(right.id),
      );
      const primary = sorted[0];
      return {
        ...primary,
        occurrences: group.length,
        sources: [...new Set(group.map((record) => record.sourceRef).filter(Boolean))].sort(),
        duplicate_ids: sorted.slice(1).map((record) => record.id),
      };
    })
    .sort((left, right) => left.seq - right.seq);
}

export function reconstructView(input, options = {}) {
  const records = options.activeIds
    ? input.records.filter((record) => options.activeIds.has(record.sourceRef ?? record.id))
    : input.records;
  return buildView({ ...input, records });
}

export function stableSourceHash(buffer) {
  return sha256(buffer);
}
