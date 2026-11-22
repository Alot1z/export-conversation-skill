/** Generic JSONL import. Malformed lines become UNKNOWN records with line evidence. */

import { readInput } from "../core/ingest/detect.mjs";
import { parseJsonl } from "../core/ingest/jsonl.mjs";
import { messageFromValue } from "../core/ingest/normalize.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

export default {
  id: "generic-jsonl",
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
    const parsed = parseJsonl(buffer.toString("utf8"));
    const messages = parsed.records.map((entry) => {
      const message = messageFromValue(entry.value);
      return {
        ...message,
        sourceRef: entry.value?.id ?? entry.value?.uuid ?? `line:${entry.line}`,
      };
    });
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: options.conversationId, title: options.title },
      messages,
      boundary: {
        kind: "file",
        total_known: true,
        total_records: messages.length,
        records_available: messages.length,
        history_complete: options.complete ?? true,
      },
      warnings: parsed.malformed.map(
        (entry) => `line ${entry.line} could not be parsed and is preserved as UNKNOWN`,
      ),
      capabilities: this.capabilities,
      options,
    });
  },
};
