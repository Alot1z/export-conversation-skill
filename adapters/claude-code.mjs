/**
 * Claude Code JSONL. Live layout observed: `type` user/assistant, uuid,
 * parentUuid, message.content parts including tool_use and tool_result.
 */

import path from "node:path";
import { readInput } from "../core/ingest/detect.mjs";
import { parseJsonl } from "../core/ingest/jsonl.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

function slug(value) {
  return String(value ?? "session").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export default {
  id: "claude-code",
  version: "1.0.0",
  harness: "claude-code",
  kind: "native",
  evidence: "live",
  capabilities: capabilities({
    toolCalls: true,
    toolResults: true,
    timestamps: true,
    originalIds: true,
    fullHistory: true,
  }),
  async capture({ input, options = {} }) {
    const parsed = parseJsonl(readInput(input).toString("utf8"));
    const records = [];
    let seq = 0;
    let sessionId = null;
    let title = options.title ?? null;

    const push = (record) => records.push({ seq: seq++, ...record });

    for (const entry of parsed.records) {
      const line = entry.value;
      if (!line || typeof line !== "object") continue;
      sessionId = sessionId ?? line.sessionId ?? null;
      if (line.type !== "user" && line.type !== "assistant") {
        push({
          role: "unknown",
          type: "unknown",
          content: JSON.stringify(line),
          timestamp: line.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: line.uuid ?? `line:${entry.line}`,
          unknown: true,
          status: "non-message",
          raw: line,
        });
        continue;
      }
      const message = line.message ?? {};
      const content = message.content;
      const parts = Array.isArray(content)
        ? content
        : [{ type: "text", text: typeof content === "string" ? content : "" }];
      const textParts = [];
      for (const [partIndex, part] of parts.entries()) {
        if (typeof part === "string") {
          textParts.push(part);
          continue;
        }
        if (part?.type === "tool_use") {
          push({
            role: "assistant",
            type: "tool_call",
            content: JSON.stringify(part.input ?? null),
            timestamp: line.timestamp ?? null,
            provenance: "IMPORTED",
            sourceRef: `${line.uuid ?? entry.line}:${part.id ?? partIndex}`,
            parentId: line.parentUuid ?? null,
            toolCallId: part.id ?? null,
            raw: part,
          });
          continue;
        }
        if (part?.type === "tool_result") {
          push({
            role: "tool",
            type: "tool_result",
            content:
              typeof part.content === "string"
                ? part.content
                : Array.isArray(part.content)
                  ? part.content.map((item) => item.text ?? "").join("\n")
                  : JSON.stringify(part.content ?? null),
            timestamp: line.timestamp ?? null,
            provenance: "IMPORTED",
            sourceRef: `${line.uuid ?? entry.line}:${part.tool_use_id ?? partIndex}`,
            parentId: line.parentUuid ?? null,
            toolCallId: part.tool_use_id ?? null,
            status: part.is_error ? "error" : null,
            raw: part,
          });
          continue;
        }
        if (part?.type === "text" || part?.type === "thinking" || typeof part?.text === "string") {
          textParts.push(part.text ?? "");
          continue;
        }
        push({
          role: "unknown",
          type: "unknown",
          content: JSON.stringify(part),
          timestamp: line.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: `${line.uuid ?? entry.line}:${partIndex}`,
          unknown: true,
          status: "unsupported-part",
          raw: part,
        });
      }
      if (textParts.some((text) => text.trim())) {
        const text = textParts.filter((part) => part.trim()).join("\n");
        push({
          role: line.type,
          type: "message",
          content: text,
          timestamp: line.timestamp ?? null,
          provenance: "IMPORTED",
          sourceRef: line.uuid ?? `line:${entry.line}`,
          parentId: line.parentUuid ?? null,
          raw: line,
        });
        if (!title && line.type === "user") title = text.slice(0, 80);
      }
    }

    const conversationId = options.conversationId ?? `claude-${slug(sessionId ?? path.basename(input))}`;
    const view = finalizeCapture({
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
      warnings: parsed.malformed.map((entry) => `line ${entry.line} is malformed and preserved`),
      capabilities: this.capabilities,
      options: { ...options, conversationId, title },
    });
    return view;
  },
};
