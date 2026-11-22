/**
 * Adapter registry. Core knows only this contract; harness-specific code never
 * lives in core and never needs to be installed for the core to work.
 */

import { SOURCE_KINDS } from "./canonical.mjs";

const registry = new Map();

export const CAPABILITY_KEYS = Object.freeze([
  "user",
  "assistant",
  "system",
  "toolCalls",
  "toolResults",
  "attachments",
  "timestamps",
  "originalIds",
  "pagination",
  "fullHistory",
]);

export function validateAdapter(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== "object") return { ok: false, errors: ["adapter is not an object"] };
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(adapter.id ?? "")) errors.push("id must be a lowercase slug");
  if (!/^\d+\.\d+\.\d+$/.test(adapter.version ?? "")) errors.push("version must be semver");
  if (!adapter.harness) errors.push("harness is required");
  if (!SOURCE_KINDS.includes(adapter.kind)) errors.push("kind must be native, official-export or generic-import");
  if (typeof adapter.capture !== "function") errors.push("capture() is required");
  if (!adapter.capabilities || typeof adapter.capabilities !== "object") {
    errors.push("capabilities are required");
  } else {
    for (const key of CAPABILITY_KEYS) {
      if (typeof adapter.capabilities[key] !== "boolean") {
        errors.push(`capability ${key} must be boolean`);
      }
    }
  }
  if (adapter.discover !== undefined && typeof adapter.discover !== "function") {
    errors.push("discover must be a function when present");
  }
  return { ok: errors.length === 0, errors };
}

export function registerAdapter(adapter) {
  const result = validateAdapter(adapter);
  if (!result.ok) {
    const error = new Error(`Invalid adapter ${adapter?.id ?? "unknown"}: ${result.errors.join("; ")}`);
    error.code = "INVALID_ADAPTER";
    throw error;
  }
  if (registry.has(adapter.id)) {
    const error = new Error(`Adapter already registered: ${adapter.id}`);
    error.code = "DUPLICATE_ADAPTER";
    throw error;
  }
  registry.set(adapter.id, adapter);
  return adapter;
}

export function getAdapter(id) {
  return registry.get(id) ?? null;
}

export function listAdapters() {
  return [...registry.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((adapter) => ({
      id: adapter.id,
      version: adapter.version,
      harness: adapter.harness,
      kind: adapter.kind,
      capabilities: adapter.capabilities,
      discoverable: typeof adapter.discover === "function",
      evidence: adapter.evidence ?? "unspecified",
    }));
}

export function adapterDescriptors() {
  return [...registry.values()].map((adapter) => ({
    id: adapter.id,
    harness: adapter.harness,
    kind: adapter.kind,
    capabilities: adapter.capabilities,
  }));
}
