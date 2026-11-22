/**
 * Coverage is three independent dimensions plus a source boundary.
 *
 * A complete export of a deliberate selection is not a complete conversation.
 * A source that exposes only a context window is never complete history.
 */

import { COVERAGE_STATUS, PROVENANCE } from "./canonical.mjs";

function statusOrThrow(status) {
  if (!COVERAGE_STATUS.includes(status)) throw new Error(`Invalid coverage status: ${status}`);
  return status;
}

export function normalizeBoundary(input = {}, records = []) {
  const available = Number.isInteger(input.records_available)
    ? input.records_available
    : records.length;
  return {
    kind: input.kind ?? "unknown",
    total_known: Boolean(input.total_known),
    total_records: Number.isInteger(input.total_records) ? input.total_records : null,
    records_available: available,
    records_captured: records.length,
    records_unavailable: Number.isInteger(input.records_unavailable)
      ? input.records_unavailable
      : Math.max(0, available - records.length),
    history_complete: Boolean(input.history_complete),
  };
}

export function provenanceCounts(records) {
  const counts = {};
  for (const provenance of PROVENANCE) counts[provenance.toLowerCase()] = 0;
  for (const record of records) {
    const key = String(record.provenance ?? "UNKNOWN").toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
    if (record.provenance === "UNKNOWN") counts.unverified = (counts.unverified ?? 0) + 1;
  }
  counts.total = records.length;
  counts.unavailable = 0;
  counts.unverified = counts.unverified ?? 0;
  return counts;
}

export function computeSourceCoverage(boundary, records) {
  const captured = records.length;
  let status;
  let reason;
  if (captured === 0) {
    status = "UNAVAILABLE";
    reason = "no records were captured";
  } else if (boundary.history_complete && boundary.records_unavailable === 0) {
    status = "COMPLETE";
    reason = "source reports complete history and no unavailable records";
  } else if (!boundary.total_known) {
    status = "UNKNOWN";
    reason = "source total is unknown; completeness cannot be established";
  } else {
    status = "PARTIAL";
    reason = `${captured} of ${boundary.records_available} available records captured`;
  }
  return {
    status: statusOrThrow(status),
    reason,
    total_known: boundary.total_known,
    total_records: boundary.total_records,
    available: boundary.records_available,
    captured,
    unavailable: boundary.records_unavailable,
    history_complete: boundary.history_complete,
  };
}

export function computeSelectionCoverage(records, selectedIds) {
  if (selectedIds === null || selectedIds === undefined) {
    return {
      status: "COMPLETE",
      reason: "all available records selected",
      available: records.length,
      selected: records.length,
    };
  }
  const selected = new Set(selectedIds);
  const selectedCount = records.filter((record) => selected.has(record.id)).length;
  const missing = selectedCount === 0;
  const all = selectedCount === records.length;
  return {
    status: missing ? "UNAVAILABLE" : all ? "COMPLETE" : "PARTIAL",
    reason: `${selectedCount} of ${records.length} records selected`,
    available: records.length,
    selected: selectedCount,
    excluded: records.length - selectedCount,
  };
}

export function computeExportCoverage(selectedCount, renderedCount) {
  if (selectedCount === 0) {
    return { status: "UNAVAILABLE", reason: "nothing selected", selected: 0, rendered: 0 };
  }
  if (renderedCount >= selectedCount) {
    return {
      status: "COMPLETE",
      reason: "every selected record was rendered",
      selected: selectedCount,
      rendered: renderedCount,
    };
  }
  return {
    status: renderedCount === 0 ? "UNAVAILABLE" : "PARTIAL",
    reason: `${renderedCount} of ${selectedCount} selected records rendered`,
    selected: selectedCount,
    rendered: renderedCount,
  };
}

export function computeCoverage({
  records,
  boundary,
  selectedIds = null,
  renderedCount = null,
  selectionOverride = null,
}) {
  const normalized = normalizeBoundary(boundary ?? {}, records);
  const selection = selectionOverride ?? computeSelectionCoverage(records, selectedIds);
  const rendered = renderedCount === null ? selection.selected : renderedCount;
  const counts = provenanceCounts(records);
  counts.unavailable = normalized.records_unavailable;
  return {
    source: computeSourceCoverage(normalized, records),
    selection,
    export: computeExportCoverage(selection.selected, rendered),
    counts,
    boundary: normalized,
  };
}

export function applyCoverage(view, options = {}) {
  view.coverage = computeCoverage({
    records: view.records,
    boundary: options.boundary ?? view.boundary,
    selectedIds: options.selectedIds ?? null,
    renderedCount: options.renderedCount ?? null,
    selectionOverride: options.selectionOverride ?? null,
  });
  view.boundary = view.coverage.boundary;
  return view;
}

export function coverageSummary(coverage) {
  if (!coverage) return "no coverage";
  return ["source", "selection", "export"]
    .map((dimension) => `${dimension}=${coverage[dimension]?.status ?? "UNKNOWN"}`)
    .join(" ");
}
