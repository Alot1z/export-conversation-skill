#!/usr/bin/env node
/**
 * Count a neutral conversation transcript and emit coverage metadata.
 *
 * Usage:
 *   node coverage.mjs <conversation.json> [--json] [--front-matter]
 *
 * The JSON shape is described by schemas/conversation.schema.json. This tool
 * does not read harness-specific stores; it makes coverage explicit once a
 * transcript has been normalized.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const VERSION = "2.2.1";

export function coverageOf(transcript) {
  if (!transcript || typeof transcript !== "object") throw new Error("transcript must be an object");
  if (!transcript.session_id) throw new Error("transcript.session_id is required");
  if (!Array.isArray(transcript.messages) || transcript.messages.length === 0) {
    throw new Error("transcript.messages must be a non-empty array");
  }

  const counts = { user: 0, assistant: 0, tool: 0, system: 0 };
  transcript.messages.forEach((message, index) => {
    if (!message || typeof message !== "object") throw new Error(`message ${index + 1} is not an object`);
    if (!(message.role in counts)) throw new Error(`message ${index + 1} has an unknown role: ${message.role}`);
    if (typeof message.content !== "string") throw new Error(`message ${index + 1} has no content`);
    counts[message.role] += 1;
  });

  return {
    session_id: transcript.session_id,
    harness: transcript.harness ?? "unknown",
    messages: transcript.messages.length,
    counts,
    last_message: transcript.messages.length,
    coverage: "full",
  };
}

function main() {
  const usage = "Usage: node coverage.mjs <conversation.json> [--json] [--front-matter]";
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage);
    return;
  }

  const file = args.find((arg) => !arg.startsWith("-"));
  if (!file) {
    console.log(usage);
    process.exit(1);
  }

  let result;
  try {
    result = coverageOf(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    console.error(`${basename(file)}: ${error.message}`);
    process.exit(1);
  }

  if (args.includes("--front-matter")) {
    console.log(`session: ${result.session_id}`);
    console.log(`last_message: ${result.last_message}`);
    console.log(`coverage: ${result.coverage}`);
  } else if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `${result.messages} messages (${result.counts.user} user, ${result.counts.assistant} assistant, ${result.counts.tool} tool); coverage: ${result.coverage}`,
    );
  }
}

const self = basename(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? basename(process.argv[1]) : "";
if (invoked && decodeURIComponent(self) === invoked) {
  main();
}
