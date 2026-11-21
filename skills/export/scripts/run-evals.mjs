#!/usr/bin/env node
/**
 * Export-contract evals: run the validator against seeded documents and check
 * that each defect is detected.
 *
 * Usage:
 *   node run-evals.mjs [--json]
 *
 * These are structural evals, not model-behavior evals. They answer "does the
 * gate catch this class of export?" and are safe to run in CI.
 */

import { validateExport } from "./validate-export.mjs";

const FRONT_MATTER = `---
export_id: eval
session: eval
last_message: 1
generated_at: 2026-11-21T00:00:00Z
generator: export-conversation 2.2.0
coverage: full
---
`;

function doc({ messages = 1, coverage = "full", body = "", lastMessage = 1 } = {}) {
  const entries = Array.from({ length: messages }, (_, index) =>
    `<!-- export:message:${index + 1} -->\n### ${index + 1} User\n\nmessage\n`,
  ).join("\n");

  return `${FRONT_MATTER.replace("coverage: full", `coverage: ${coverage}`).replace("last_message: 1", `last_message: ${lastMessage}`)}
# Conversation Export

<!-- export:generated:summary:start -->
## Conversation Summary

Summary.
<!-- export:generated:summary:end -->

<!-- export:generated:visual:start -->
## Visual Overview

No diagrams.
<!-- export:generated:visual:end -->

## Full Conversation

<!-- export:messages:start -->
${entries}
<!-- export:messages:end -->

<!-- export:generated:stats:start -->
## Session Statistics

- Messages: ${messages}
<!-- export:generated:stats:end -->

<!-- export:generated:files:start -->
## Files Changed

None.
<!-- export:generated:files:end -->
${body}`;
}

const cases = [
  { name: "valid export", text: doc(), expect: [] },
  { name: "missing front matter", text: "# Broken\n", expect: ["front matter"] },
  { name: "secret present", text: doc({ body: "key: sk-abcdefghijklmnopqrstuvwx" }), expect: ["secret"] },
  { name: "wrong last_message", text: doc({ messages: 2, lastMessage: 9 }), expect: ["last_message"] },
  { name: "partial coverage", text: doc({ coverage: "partial (messages 1-2 summarized)" }), expect: [], warning: "partial" },
];

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log("Usage: node run-evals.mjs [--json]");
    return;
  }

  const results = cases.map((testCase) => {
    const result = validateExport(testCase.text);
    const missing = testCase.expect.filter(
      (fragment) => !result.errors.some((error) => error.includes(fragment)),
    );
    if (testCase.warning) {
      if (!result.warnings.some((warning) => warning.includes(testCase.warning))) {
        missing.push(`warning:${testCase.warning}`);
      }
    }
    return { name: testCase.name, pass: missing.length === 0, missing, errors: result.errors, warnings: result.warnings };
  });

  const failed = results.filter((result) => !result.pass);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.pass ? "pass" : "FAIL"}  ${result.name}`);
      for (const missing of result.missing) console.log(`  missing expected: ${missing}`);
    }
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main();
