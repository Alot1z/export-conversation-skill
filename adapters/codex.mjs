/** Codex session JSONL. Verified against a fixture, not a live installation. */

import path from "node:path";
import { readInput } from "../core/ingest/detect.mjs";
import { parseJsonl } from "../core/ingest/jsonl.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part?.text ?? part?.content ?? "")
    .filter(Boolean)
    .join("\n");
}

export default {
  id: "codex",
  version: "1.0.0",
  harness: "codex",
  kind: "native",
  evidence: "fixture",
  capabilities: capabilities({
    toolCalls: true,
    toolResults: true,
    timestamps: true,
    fullHistory: true,
  }),
  async capture({ input, options = {} }) {
    const parsed = parseJsonl(readInput(input).toString("utf8"));
    const records = [];
    const events = [];
    let seq = 0;
    let sessionId = null;
    let title = options.title ?? null;
    const push = (record) => records.push({ seq: seq++, ...record });

    for (const entry of parsed.records) {
      const line = entry.value;
      if (!line || typeof line !== "object") continue;
      const payload = line.payload ?? {};
      if (line.type === "session_meta") {
        sessionId = payload.id ?? sessionId;
        events.push({ type: "session_meta", timestamp: line.timestamp ?? null, data: payload });
        continue;
      }
      if (line.type === "event_msg") {
        events.push({
          type: payload.type ?? "event",
          timestamp: line.timestamp ?? null,
          data: payload,
        });
        if (payload.type === "agent_message" && payload.message && !title) {
          title = String(payload.message).slice(0, 80);
        }
        continue;
      }
      if (line.type === "response_item") {
        if (payload.type === "message") {
          push({
            role: payload.role ?? "assistant",
            type: "message",
            content: contentText(payload.content),
            timestamp: line.timestamp ?? null,
            provenance: "IMPORTED",
            sourceRef: line.id ?? `line:${entry.line}`,
            raw: payload,
          });
          continue;
        }
        if (payload.type === "function_call") {
          push({
            role: "assistant",
            type: "tool_call",
            content: payload.arguments ?? "",
            timestamp: line.timestamp ?? null,
            provenance: "IMPORTED",
            sourceRef: payload.call_id ?? `line:${entry.line}`,
            toolCallId: payload.call_id ?? null,
            raw: payload,
          });
          continue;
        }
        if (payload.type === "function_call_output") {
          push({
            role: "tool",
            type: "tool_result",
            content: payload.output ?? "",
            timestamp: line.timestamp ?? null,
            provenance: "IMPORTED",
            sourceRef: payload.call_id ?? `line:${entry.line}`,
            toolCallId: payload.call_id ?? null,
            raw: payload,
          });
          continue;
        }
      }
      push({
        role: "unknown",
        type: "unknown",
        content: JSON.stringify(line),
        timestamp: line.timestamp ?? null,
        provenance: "IMPORTED",
        sourceRef: line.id ?? `line:${entry.line}`,
        unknown: true,
        raw: line,
      });
    }

    const conversationId =
      options.conversationId ?? `codex-${String(sessionId ?? path.basename(input)).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: conversationId, title },
      records,
      events,
      boundary: {
        kind: "session-file",
        total_known: true,
        total_records: records.length,
        records_available: records.length,
        history_complete: true,
      },
      warnings: parsed.malformed.map((entry) => `line ${entry.line} is malformed and preserved`),
      capabilities: this.capabilities,
      options: { ...options, conversationId, title },
    });
  },
};
