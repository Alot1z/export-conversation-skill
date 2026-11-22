/** Gemini CLI recorded chat. Supports the session object and JSONL line format. */

import path from "node:path";
import { readInput } from "../core/ingest/detect.mjs";
import { parseJsonl } from "../core/ingest/jsonl.mjs";
import { textFromContent } from "../core/ingest/normalize.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

function normalizeType(type) {
  if (type === "gemini" || type === "model" || type === "assistant") return "assistant";
  if (type === "user" || type === "human") return "user";
  if (type === "system" || type === "info") return "system";
  return type ?? "unknown";
}

export default {
  id: "gemini-cli",
  version: "1.0.0",
  harness: "gemini-cli",
  kind: "native",
  evidence: "official-format",
  capabilities: capabilities({
    system: true,
    toolCalls: true,
    timestamps: true,
    originalIds: true,
    fullHistory: true,
  }),
  async capture({ input, options = {} }) {
    const text = readInput(input).toString("utf8");
    let sessionId = null;
    let sourceMessages = [];
    let malformed = [];
    try {
      const whole = JSON.parse(text);
      if (whole && Array.isArray(whole.messages)) {
        sessionId = whole.sessionId ?? whole.session_id ?? null;
        sourceMessages = whole.messages;
      }
    } catch {
      // Fall through to JSONL.
    }
    if (sourceMessages.length === 0) {
      const parsed = parseJsonl(text);
      malformed = parsed.malformed;
      sourceMessages = parsed.records.map((entry) => entry.value);
    }

    const records = [];
    let seq = 0;
    let title = options.title ?? null;
    const push = (record) => records.push({ seq: seq++, ...record });

    for (const message of sourceMessages) {
      if (!message || typeof message !== "object") continue;
      sessionId = sessionId ?? message.sessionId ?? null;
      const type = normalizeType(message.type ?? message.role);
      const content = textFromContent(message.content ?? message.message ?? message.text ?? "");
      if (content) {
        push({
          role: type,
          type: "message",
          content,
          timestamp: message.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: message.id ?? null,
          raw: message,
        });
        if (!title && type === "user") title = content.slice(0, 80);
      }
      for (const call of message.toolCalls ?? message.tool_calls ?? []) {
        push({
          role: "assistant",
          type: "tool_call",
          content: JSON.stringify(call.args ?? call.arguments ?? call.input ?? null),
          timestamp: message.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: call.id ?? null,
          toolCallId: call.id ?? null,
          raw: call,
        });
      }
      if (!content && !(message.toolCalls ?? message.tool_calls)?.length) {
        push({
          role: "unknown",
          type: "unknown",
          content: JSON.stringify(message),
          timestamp: message.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: message.id ?? null,
          unknown: true,
          raw: message,
        });
      }
    }

    const conversationId =
      options.conversationId ??
      `gemini-${String(sessionId ?? path.basename(input)).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: conversationId, title },
      records,
      boundary: {
        kind: "session-file",
        total_known: true,
        total_records: records.length,
        records_available: records.length,
        history_complete: true,
      },
      warnings: malformed.map((entry) => `line ${entry.line} is malformed and preserved`),
      capabilities: this.capabilities,
      options: { ...options, conversationId, title },
    });
  },
};
