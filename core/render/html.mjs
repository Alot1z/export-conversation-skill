/** Self-contained HTML renderer. All content is escaped; no script is emitted. */

import { coverageSummary } from "../coverage.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(view, options = {}) {
  const coverage = view.coverage ?? {};
  const title = escapeHtml(view.conversation?.title ?? "Conversation");
  const rows = view.records
    .map(
      (record, index) => `<article class="record" data-provenance="${escapeHtml(record.provenance)}">
  <h3>${index + 1}. ${escapeHtml(String(record.role).toUpperCase())} <span class="time">${escapeHtml(record.timestamp ?? "unknown time")}</span></h3>
  <p class="meta">provenance=${escapeHtml(record.provenance)} · id=${escapeHtml(record.id)}</p>
  ${record.unknown || record.type === "unknown" ? '<p class="unknown">UNKNOWN record — raw evidence preserved.</p>' : ""}
  <pre>${escapeHtml(record.content)}</pre>
</article>`,
    )
    .join("\n");
  const coverageRows = ["source", "selection", "export"]
    .map(
      (dimension) =>
        `<tr><th>${dimension}</th><td>${escapeHtml(coverage[dimension]?.status ?? "UNKNOWN")}</td><td>${escapeHtml(coverage[dimension]?.reason ?? "")}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1d232a;background:#fbfbfa}
h1{border-bottom:1px solid #d8d8d4;padding-bottom:.5rem}
.record{border-left:3px solid #b9b9b2;padding:.25rem 1rem;margin:1.25rem 0}
.record[data-provenance="RECONSTRUCTED"]{border-color:#c58b2a}
.record[data-provenance="UNKNOWN"]{border-color:#b23a3a}
pre{white-space:pre-wrap;word-wrap:break-word;background:#f1f1ee;padding:.75rem;border-radius:4px}
.meta,.time{font-size:.8rem;color:#5c646d;font-weight:400}
.unknown{color:#b23a3a}
table{border-collapse:collapse}th,td{border:1px solid #d8d8d4;padding:.25rem .5rem;text-align:left}
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">Schema 2 · ${escapeHtml(coverageSummary(coverage))} · generated ${escapeHtml(options.generatedAt ?? view.conversation?.captured_at ?? "unknown")}</p>
<h2>Coverage</h2>
<table><thead><tr><th>Dimension</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${coverageRows}</tbody></table>
<h2>Messages</h2>
${rows || "<p>No records were captured.</p>"}
<hr>
<p class="meta">Coverage is relative to the source boundary. Unknown records are preserved, not omitted.</p>
</body>
</html>
`;
}
