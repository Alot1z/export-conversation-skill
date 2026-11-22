/** Built-in adapter registration. Importing this module is optional. */

import { registerAdapter, getAdapter } from "../core/registry.mjs";
import genericJson from "./generic-json.mjs";
import genericJsonl from "./generic-jsonl.mjs";
import claudeCode from "./claude-code.mjs";
import codex from "./codex.mjs";
import geminiCli from "./gemini-cli.mjs";
import chatgptExport from "./chatgpt-export.mjs";
import openhandsTranscript from "./openhands-transcript.mjs";
import freebuffThreadContext from "./freebuff-thread-context.mjs";

const BUILT_INS = [
  genericJson,
  genericJsonl,
  claudeCode,
  codex,
  geminiCli,
  chatgptExport,
  openhandsTranscript,
  freebuffThreadContext,
];

for (const adapter of BUILT_INS) {
  if (!getAdapter(adapter.id)) registerAdapter(adapter);
}

export {
  genericJson,
  genericJsonl,
  claudeCode,
  codex,
  geminiCli,
  chatgptExport,
  openhandsTranscript,
  freebuffThreadContext,
};
export { getAdapter, listAdapters } from "../core/registry.mjs";
