/**
 * Canonical conversation model (schema v2).
 *
 * Raw source records are kept verbatim. A view is derived from them and can be
 * regenerated deterministically: the same raw input always produces the same
 * view bytes, so integrity and verification never depend on wall-clock time.
 */

import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 2;

export const PROVENANCE = Object.freeze([
  "ORIGINAL",
  "IMPORTED",
  "RECONSTRUCTED",
  "DERIVED",
  "SUMMARISED",
  "TRANSFORMED",
  "REDACTED",
  "UNKNOWN",
]);

export const COVERAGE_STATUS = Object.freeze(["COMPLETE", "PARTIAL", "UNKNOWN", "UNAVAILABLE"]);

export const SOURCE_KINDS = Object.freeze(["native", "official-export", "generic-import"]);

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashObject(value) {
  return sha256(stableStringify(value));
}

function normalizationFields(input) {
  return {
    seq: Number.isInteger(input.seq) ? input.seq : 0,
    role: input.role ?? "unknown",
    type: input.type ?? "message",
    content: input.content ?? "",
    timestamp: input.timestamp ?? null,
    provenance: PROVENANCE.includes(input.provenance) ? input.provenance : "UNKNOWN",
    source: input.source ?? null,
    sourceRef: input.sourceRef ?? null,
    parentId: input.parentId ?? null,
    branchId: input.branchId ?? "main",
    toolCallId: input.toolCallId ?? null,
    status: input.status ?? null,
    unknown: Boolean(input.unknown),
  };
}

/**
 * Build one immutable canonical record. `raw` is stored untouched and hashed
 * separately so that later normalization can never rewrite source evidence.
 */
export function makeRecord(input = {}) {
  const fields = normalizationFields(input);
  const raw = input.raw === undefined ? null : input.raw;
  const record = {
    id: input.id ?? `rec-${hashObject(fields).slice(0, 16)}`,
    ...fields,
    raw,
    rawHash: raw === null ? null : hashObject(raw),
  };
  record.hash = hashObject({
    id: record.id,
    ...fields,
  });
  return record;
}

export function makeAttachment(input = {}) {
  const content = input.content ?? null;
  return {
    id: input.id ?? `att-${hashObject({ name: input.name ?? "", content }).slice(0, 16)}`,
    name: input.name ?? "attachment",
    mediaType: input.mediaType ?? "application/octet-stream",
    bytes: content === null ? input.bytes ?? 0 : Buffer.byteLength(content),
    sha256: content === null ? input.sha256 ?? null : sha256(content),
    path: input.path ?? null,
    status: input.status ?? "present",
  };
}

function branchOrder(records) {
  const branches = new Map();
  for (const record of records) {
    const branch = record.branchId || "main";
    if (!branches.has(branch)) branches.set(branch, []);
    branches.get(branch).push(record.id);
  }
  return [...branches.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, messageIds]) => ({ id, messageIds }));
}

/**
 * Derive the normalized view from immutable records. Deterministic: no clock,
 * no locale-dependent sorting, no mutation of the input records.
 */
export function buildView(input = {}) {
  const records = (input.records ?? []).map((record) =>
    record && record.hash ? record : makeRecord(record),
  );
  const ordered = [...records].sort((left, right) => {
    if (left.seq !== right.seq) return left.seq - right.seq;
    const leftTime = left.timestamp ?? "";
    const rightTime = right.timestamp ?? "";
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.id.localeCompare(right.id);
  });

  const branches = branchOrder(ordered);
  const requested = input.activeBranch ?? input.conversation?.active_branch ?? "main";
  const activeBranch = branches.some((branch) => branch.id === requested) ? requested : "main";

  const calls = new Map();
  const results = new Map();
  for (const record of ordered) {
    if (record.type === "tool_call" && record.toolCallId) calls.set(record.toolCallId, record);
    if (record.type === "tool_result" && record.toolCallId) results.set(record.toolCallId, record);
  }
  const toolPairs = [...new Set([...calls.keys(), ...results.keys()])]
    .sort()
    .map((callId) => {
      const call = calls.get(callId) ?? null;
      const result = results.get(callId) ?? null;
      const status = call && result ? "complete" : call ? "missing_result" : "orphan_result";
      return { callId, status, callIdRecord: call?.id ?? null, resultId: result?.id ?? null };
    });

  const conversation = {
    ...(input.conversation ?? {}),
    id: input.conversation?.id ?? "conversation",
    title: input.conversation?.title ?? "Conversation",
    active_branch: activeBranch,
  };

  const view = {
    schema_version: SCHEMA_VERSION,
    conversation,
    source: input.source ?? conversation.source ?? null,
    boundary: input.boundary ?? conversation.boundary ?? {
      kind: "unknown",
      total_known: false,
      total_records: null,
      records_available: ordered.length,
      records_captured: ordered.length,
      records_unavailable: 0,
      history_complete: false,
    },
    branches,
    records: ordered,
    events: input.events ?? [],
    attachments: (input.attachments ?? []).map((entry) => makeAttachment(entry)),
    tool_pairs: toolPairs,
    coverage: null,
    warnings: input.warnings ?? [],
  };
  return view;
}

export function viewHash(view) {
  return hashObject(view);
}

export function validateConversation(view) {
  const errors = [];
  if (!view || typeof view !== "object") return { ok: false, errors: ["view is not an object"] };
  if (view.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (!view.conversation?.id) errors.push("conversation.id is required");
  if (!view.source?.adapter) errors.push("source.adapter is required");
  if (!SOURCE_KINDS.includes(view.source?.kind)) errors.push("source.kind is invalid");
  if (!Array.isArray(view.records)) errors.push("records must be an array");
  if (!Array.isArray(view.branches)) errors.push("branches must be an array");
  if (!view.coverage) {
    errors.push("coverage is missing");
  } else {
    for (const dimension of ["source", "selection", "export"]) {
      const status = view.coverage[dimension]?.status;
      if (!COVERAGE_STATUS.includes(status)) errors.push(`coverage.${dimension}.status is invalid`);
    }
  }
  const ids = new Set();
  for (const record of view.records ?? []) {
    if (!record.id) errors.push("record without id");
    if (ids.has(record.id)) errors.push(`duplicate record id: ${record.id}`);
    ids.add(record.id);
    if (!PROVENANCE.includes(record.provenance)) {
      errors.push(`record ${record.id} has invalid provenance`);
    }
    if (record.unknown && record.type !== "unknown") {
      errors.push(`record ${record.id} is marked unknown with type ${record.type}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function countRecords(records, predicate) {
  return records.reduce((total, record) => total + (predicate(record) ? 1 : 0), 0);
}
