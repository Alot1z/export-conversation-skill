/** Search, comparison and deduplication over canonical conversations. */

import { hashObject } from "./canonical.mjs";
import { listConversations, readConversation } from "./store.mjs";

function snippet(text, needle) {
  const value = String(text ?? "");
  const index = value.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return value.slice(0, 160);
  const start = Math.max(0, index - 60);
  return `${start > 0 ? "…" : ""}${value.slice(start, index + needle.length + 60)}…`;
}

export function searchProject(projectRoot, options = {}) {
  const filters = {
    text: options.text ? String(options.text) : null,
    role: options.role ? String(options.role).toLowerCase() : null,
    adapter: options.adapter ?? null,
    tool: options.tool ? String(options.tool) : null,
    from: options.from ?? null,
    to: options.to ?? null,
    limit: Number.isInteger(options.limit) ? options.limit : 100,
  };
  const hits = [];
  const errors = [];
  for (const summary of listConversations(projectRoot)) {
    if (summary.status !== "ok") {
      errors.push({ conversation: summary.id, error: summary.error });
      continue;
    }
    if (filters.adapter && summary.source?.adapter !== filters.adapter) continue;
    let conversation;
    try {
      conversation = readConversation(projectRoot, summary.id);
    } catch (error) {
      errors.push({ conversation: summary.id, error: error.message });
      continue;
    }
    for (const record of conversation.view?.records ?? []) {
      if (filters.role && record.role !== filters.role) continue;
      if (filters.tool && record.toolCallId !== filters.tool) continue;
      if (filters.from && String(record.timestamp ?? "") < filters.from) continue;
      if (filters.to && String(record.timestamp ?? "") > filters.to) continue;
      if (filters.text) {
        const haystack = `${record.content}\n${record.raw ? JSON.stringify(record.raw) : ""}`;
        if (!haystack.toLowerCase().includes(filters.text.toLowerCase())) continue;
      }
      hits.push({
        conversation_id: summary.id,
        title: summary.title,
        record_id: record.id,
        seq: record.seq,
        role: record.role,
        type: record.type,
        provenance: record.provenance,
        timestamp: record.timestamp,
        snippet: filters.text ? snippet(record.content, filters.text) : record.content.slice(0, 160),
      });
      if (hits.length >= filters.limit) return { hits, errors, truncated: true };
    }
  }
  return { hits, errors, truncated: false };
}

export function compareViews(left, right) {
  const leftById = new Map(left.records.map((record) => [record.id, record]));
  const rightById = new Map(right.records.map((record) => [record.id, record]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, record] of rightById) {
    if (!leftById.has(id)) added.push(record);
    else if (leftById.get(id).hash !== record.hash) {
      changed.push({ id, left: leftById.get(id).hash, right: record.hash });
    }
  }
  for (const [id, record] of leftById) if (!rightById.has(id)) removed.push(record);
  return {
    added,
    removed,
    changed,
    unchanged: right.records.length - added.length - changed.length,
    same: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

export function dedupeViews(views) {
  const groups = new Map();
  for (const view of views) {
    for (const record of view.records) {
      const key = hashObject({ role: record.role, content: record.content, type: record.type });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        conversation_id: view.conversation.id,
        record_id: record.id,
        provenance: record.provenance,
        timestamp: record.timestamp,
      });
    }
  }
  return [...groups.values()]
    .filter((occurrences) => occurrences.length > 1)
    .map((occurrences) => ({
      key: occurrences[0].record_id,
      occurrences,
      count: occurrences.length,
      conversations: [...new Set(occurrences.map((entry) => entry.conversation_id))],
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}
