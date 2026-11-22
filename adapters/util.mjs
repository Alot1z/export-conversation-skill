/** Shared adapter helpers. Adapters produce plain records; core owns identity. */

import path from "node:path";
import { buildView } from "../core/canonical.mjs";
import { applyCoverage, normalizeBoundary } from "../core/coverage.mjs";
import { normalizeRole, textFromContent } from "../core/ingest/normalize.mjs";

export const DEFAULT_CAPABILITIES = Object.freeze({
  user: true,
  assistant: true,
  system: false,
  toolCalls: false,
  toolResults: false,
  attachments: false,
  timestamps: false,
  originalIds: false,
  pagination: false,
  fullHistory: false,
});

export function capabilities(overrides = {}) {
  return { ...DEFAULT_CAPABILITIES, ...overrides };
}

export function titleFromPath(inputPath) {
  return path.basename(inputPath).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Conversation";
}

export function messageRecord(message, seq, options = {}) {
  const role = normalizeRole(message.role);
  const unknown = Boolean(message.unknown) || (role === "unknown" && !message.type);
  return {
    seq,
    role,
    type: message.type ?? (unknown ? "unknown" : "message"),
    content: message.content ?? textFromContent(message.raw ?? ""),
    timestamp: message.timestamp ?? null,
    provenance: options.provenance ?? "IMPORTED",
    sourceRef: message.sourceRef ?? message.id ?? null,
    parentId: message.parentId ?? null,
    branchId: options.branchId ?? message.branchId ?? "main",
    toolCallId: message.toolCallId ?? null,
    status: message.status ?? null,
    unknown,
    raw: message.raw ?? null,
  };
}

/**
 * Finalize an adapter capture into the canonical view shape.
 * `records` may already contain ordered records (tool events, unknown rows);
 * `messages` are normalized message-shaped entries appended after them.
 */
export function finalizeCapture({
  adapter,
  inputPath,
  conversation = {},
  messages = [],
  records = [],
  boundary = {},
  events = [],
  attachments = [],
  warnings = [],
  capabilities: caps = DEFAULT_CAPABILITIES,
  options = {},
}) {
  const combined = [...records];
  messages.forEach((message, index) => {
    combined.push(messageRecord(message, records.length + index, options));
  });
  combined.sort((left, right) => left.seq - right.seq);

  const id =
    options.conversationId ??
    conversation.id ??
    `conv-${path.basename(inputPath).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const normalized = normalizeBoundary(boundary, combined);
  const view = buildView({
    conversation: {
      id,
      title: conversation.title ?? options.title ?? titleFromPath(inputPath),
      ...(conversation.created_at ? { created_at: conversation.created_at } : {}),
    },
    source: {
      adapter: adapter.id,
      version: adapter.version,
      harness: adapter.harness,
      kind: adapter.kind,
      ref: options.sourceRef ?? inputPath,
      capabilities: caps,
      evidence: adapter.evidence ?? "unspecified",
    },
    boundary: normalized,
    records: combined,
    events,
    attachments,
    warnings,
    activeBranch: options.activeBranch ?? conversation.active_branch ?? "main",
  });
  return applyCoverage(view, { boundary: normalized });
}

export function toolRecord({ seq, role, type, content, timestamp, toolCallId, raw, sourceRef, status }) {
  return {
    seq,
    role,
    type,
    content: typeof content === "string" ? content : JSON.stringify(content ?? null),
    timestamp: timestamp ?? null,
    provenance: "IMPORTED",
    sourceRef: sourceRef ?? null,
    toolCallId: toolCallId ?? null,
    status: status ?? null,
    raw: raw ?? null,
  };
}
