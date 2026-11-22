/** OpenHands Markdown/HTML transcript import. Tool events are not exposed. */

import { readInput } from "../core/ingest/detect.mjs";
import { htmlToMessages } from "../core/ingest/html.mjs";
import { markdownToMessages } from "../core/ingest/markdown.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

export default {
  id: "openhands-transcript",
  version: "1.0.0",
  harness: "openhands",
  kind: "official-export",
  evidence: "fixture",
  capabilities: capabilities({
    timestamps: false,
    fullHistory: false,
  }),
  async capture({ input, options = {} }) {
    const text = readInput(input).toString("utf8");
    const isHtml = /<html|<body|<h[1-6]/i.test(text.slice(0, 500));
    const parsed = isHtml ? htmlToMessages(text) : markdownToMessages(text);
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: options.conversationId, title: options.title ?? parsed.title },
      messages: parsed.messages,
      boundary: {
        kind: "transcript-file",
        total_known: false,
        total_records: null,
        records_available: parsed.messages.length,
        history_complete: false,
      },
      warnings: [
        "Transcript formats do not expose tool events or a complete history boundary",
      ],
      capabilities: this.capabilities,
      options,
    });
  },
};
