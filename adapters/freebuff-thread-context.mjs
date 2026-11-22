/**
 * Freebuff thread context payload. A context retrieval is not a complete
 * transcript: the boundary is explicitly partial and tool events are absent.
 */

import { readInput } from "../core/ingest/detect.mjs";
import { markdownToMessages } from "../core/ingest/markdown.mjs";
import { normalizeMessages } from "../core/ingest/normalize.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

export default {
  id: "freebuff-thread-context",
  version: "1.0.0",
  harness: "freebuff",
  kind: "native",
  evidence: "context-payload",
  capabilities: capabilities({
    timestamps: true,
    fullHistory: false,
  }),
  async capture({ input, options = {} }) {
    const text = readInput(input).toString("utf8");
    let messages = [];
    let title = options.title ?? null;
    let threadId = null;
    let boundaryKind = "thread-context";
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        messages = normalizeMessages(parsed);
      } else if (Array.isArray(parsed.messages)) {
        messages = normalizeMessages(parsed.messages);
        title = title ?? parsed.title ?? parsed.thread?.title ?? null;
        threadId = parsed.thread_id ?? parsed.threadId ?? parsed.thread?.id ?? null;
      } else {
        throw new Error("no messages");
      }
    } catch {
      const parsed = markdownToMessages(text);
      messages = parsed.messages;
      title = title ?? parsed.title;
      boundaryKind = "thread-context-markdown";
    }
    const conversationId =
      options.conversationId ??
      (threadId ? `freebuff-${String(threadId).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : undefined);
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: conversationId, title },
      messages,
      boundary: {
        kind: boundaryKind,
        total_known: false,
        total_records: null,
        records_available: messages.length,
        history_complete: false,
      },
      warnings: [
        "A thread context payload is not a complete transcript and omits tool events",
      ],
      capabilities: this.capabilities,
      options: { ...options, conversationId, title, provenance: "ORIGINAL" },
    });
  },
};
