/** Shared test harness: isolated projects and canonical sample input. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveConversation } from "../../core/store.mjs";
import { buildView } from "../../core/canonical.mjs";
import { applyCoverage } from "../../core/coverage.mjs";
import { renderMarkdown } from "../../core/render/markdown.mjs";
import { renderJson } from "../../core/render/json.mjs";

export function project(t, label = "project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `export-conversation-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

export function sampleInput(overrides = {}) {
  const messages = overrides.messages ?? [
    { role: "user", content: "hello", timestamp: "2026-01-01T00:00:00.000Z" },
    { role: "assistant", content: "hi there", timestamp: "2026-01-01T00:00:01.000Z" },
  ];
  return {
    conversation: { id: "sample", title: "Sample conversation", ...(overrides.conversation ?? {}) },
    source: {
      adapter: "test",
      version: "1.0.0",
      harness: "test",
      kind: "generic-import",
      ref: "fixture",
      ...(overrides.source ?? {}),
    },
    boundary: {
      kind: "fixture",
      total_known: true,
      total_records: messages.length,
      records_available: messages.length,
      records_unavailable: 0,
      history_complete: true,
      ...(overrides.boundary ?? {}),
    },
    records: messages.map((message, index) => ({
      seq: index,
      role: message.role ?? "user",
      type: message.type ?? "message",
      content: message.content ?? "",
      timestamp: message.timestamp ?? null,
      provenance: message.provenance ?? "IMPORTED",
      sourceRef: message.sourceRef ?? `fixture:${index}`,
      raw: message.raw ?? null,
      unknown: Boolean(message.unknown),
    })),
    ...(overrides.extra ?? {}),
  };
}

export function saveSample(root, overrides = {}, options = {}) {
  const input = sampleInput(overrides);
  const view = buildView(input);
  applyCoverage(view, { boundary: view.boundary });
  const now = options.now ?? "2026-11-22T00:00:00.000Z";
  const conversationId = options.conversationId ?? input.conversation.id;
  return saveConversation(root, view, {
    conversationId,
    now,
    rendered:
      options.rendered === false
        ? {}
        : {
            "export.md": renderMarkdown(view, { generatedAt: now }),
            "export.json": renderJson(view),
          },
    ...(options.save ?? {}),
  });
}
