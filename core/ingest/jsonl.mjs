/** JSON Lines reader that preserves unparseable lines instead of dropping them. */

import { messageFromValue } from "./normalize.mjs";

export function parseJsonl(text, options = {}) {
  const records = [];
  const malformed = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      records.push({ value, line: index + 1 });
    } catch (error) {
      malformed.push({ line: index + 1, error: error.message, text: line });
      if (options.preserveMalformed !== false) {
        records.push({
          value: {
            type: "unknown",
            unknown: true,
            content: line,
            raw: { line: index + 1, text: line },
          },
          line: index + 1,
        });
      }
    }
  });
  return { records, malformed, lineCount: lines.length };
}

export function jsonlToMessages(text) {
  const parsed = parseJsonl(text);
  return {
    messages: parsed.records.map((entry) => ({
      ...messageFromValue(entry.value),
      sourceRef: `line:${entry.line}`,
      line: entry.line,
    })),
    malformed: parsed.malformed,
    lineCount: parsed.lineCount,
  };
}
