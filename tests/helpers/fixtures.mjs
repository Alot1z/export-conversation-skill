/** Deterministic source fixtures used by adapter, CLI and MCP tests. */

import fs from "node:fs";
import path from "node:path";
import { buildZip } from "./zip-builder.mjs";

export function writeFixtures(root) {
  fs.mkdirSync(root, { recursive: true });
  const files = {};

  files.claude = path.join(root, "claude.jsonl");
  fs.writeFileSync(
    files.claude,
    [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "read the file" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "reading" },
            { type: "tool_use", id: "t1", name: "Read", input: { file: "x" } },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "contents" }],
        },
      },
      { type: "summary", uuid: "s2", timestamp: "2026-01-01T00:00:03Z" },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );

  files.codex = path.join(root, "codex.jsonl");
  fs.writeFileSync(
    files.codex,
    [
      { timestamp: "2026-01-01T00:00:00Z", type: "session_meta", payload: { id: "cx1" } },
      {
        timestamp: "2026-01-01T00:00:01Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi codex" }] },
      },
      {
        timestamp: "2026-01-01T00:00:02Z",
        type: "response_item",
        payload: { type: "function_call", name: "sh", arguments: '{"cmd":"ls"}', call_id: "c1" },
      },
      {
        timestamp: "2026-01-01T00:00:03Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c1", output: "ok" },
      },
      {
        timestamp: "2026-01-01T00:00:04Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );

  files.gemini = path.join(root, "gemini.json");
  fs.writeFileSync(
    files.gemini,
    JSON.stringify({
      sessionId: "g1",
      messages: [
        { id: "m1", type: "user", content: "hello gemini", timestamp: "2026-01-01T00:00:00Z" },
        {
          id: "m2",
          type: "gemini",
          content: "hello user",
          timestamp: "2026-01-01T00:00:01Z",
          toolCalls: [{ id: "gt1", name: "search", args: { q: "x" } }],
        },
      ],
    }),
  );

  files.openhands = path.join(root, "openhands.md");
  fs.writeFileSync(files.openhands, "# Session\n\n## User\nfix the bug\n\n## Assistant\nfixed it\n");

  files.freebuff = path.join(root, "freebuff.json");
  fs.writeFileSync(
    files.freebuff,
    JSON.stringify({
      thread_id: "thread-1",
      title: "Freebuff thread",
      messages: [
        { role: "user", content: "context question" },
        { role: "assistant", content: "context answer" },
      ],
    }),
  );

  files.genericJson = path.join(root, "generic.json");
  fs.writeFileSync(
    files.genericJson,
    JSON.stringify({
      title: "Imported",
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    }),
  );

  files.genericJsonl = path.join(root, "generic.jsonl");
  fs.writeFileSync(
    files.genericJsonl,
    '{"role":"user","content":"a"}\nnot json\n{"role":"assistant","content":"b"}\n',
  );

  files.chatgpt = path.join(root, "chatgpt.zip");
  const mapping = {
    root: { id: "root", parent: null, message: null },
    u1: {
      id: "u1",
      parent: "root",
      message: {
        author: { role: "user" },
        create_time: 1767225600,
        content: { content_type: "text", parts: ["zip question"] },
      },
    },
    a1: {
      id: "a1",
      parent: "u1",
      message: {
        author: { role: "assistant" },
        create_time: 1767225601,
        content: {
          content_type: "text",
          parts: ["zip answer", { asset_pointer: "file-service://file-1", content_type: "image/png" }],
        },
      },
    },
    alt: {
      id: "alt",
      parent: "u1",
      message: {
        author: { role: "assistant" },
        create_time: 1767225602,
        content: { content_type: "text", parts: ["alternative"] },
      },
    },
  };
  fs.writeFileSync(
    files.chatgpt,
    buildZip([
      {
        name: "conversations.json",
        method: 8,
        data: JSON.stringify([
          { conversation_id: "cg1", title: "ZIP chat", current_node: "a1", mapping },
        ]),
      },
    ]),
  );

  return files;
}
