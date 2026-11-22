/** Deterministic JSON renderer: the canonical view is the export. */

export function renderJson(view) {
  return `${JSON.stringify(view, null, 2)}\n`;
}

export function renderJsonl(view) {
  return `${view.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
