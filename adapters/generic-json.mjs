/** Generic JSON import: any document with a supported messages array. */

import { readInput } from "../core/ingest/detect.mjs";
import { jsonToMessages } from "../core/ingest/json.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

export default {
  id: "generic-json",
  version: "1.0.0",
  harness: "generic",
  kind: "generic-import",
  evidence: "implemented",
  capabilities: capabilities({
    system: true,
    timestamps: true,
    originalIds: true,
    fullHistory: true,
  }),
  async capture({ input, options = {} }) {
    const buffer = readInput(input);
    const parsed = jsonToMessages(buffer.toString("utf8"));
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: {
        id: options.conversationId ?? parsed.conversationId,
        title: options.title ?? parsed.title,
      },
      messages: parsed.messages,
      boundary: {
        kind: "file",
        total_known: true,
        total_records: parsed.messages.length,
        records_available: parsed.messages.length,
        history_complete: options.complete ?? true,
      },
      warnings: parsed.warnings,
      capabilities: this.capabilities,
      options: { ...options, provenance: "IMPORTED" },
    });
  },
};
