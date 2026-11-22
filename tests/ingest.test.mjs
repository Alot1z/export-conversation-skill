import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectBuffer } from "../core/ingest/detect.mjs";
import { jsonToMessages } from "../core/ingest/json.mjs";
import { jsonlToMessages, parseJsonl } from "../core/ingest/jsonl.mjs";
import { markdownToMessages } from "../core/ingest/markdown.mjs";
import { htmlToMessages, htmlToText } from "../core/ingest/html.mjs";
import {
  inspectDatabase,
  readRows,
  sqliteCapability,
  tableCounts,
} from "../core/ingest/sqlite.mjs";
import { buildZip } from "./helpers/zip-builder.mjs";

test("detects formats from bytes, not extensions", () => {
  assert.equal(detectBuffer(buildZip([{ name: "a", data: "x" }])).format, "zip");
  assert.equal(detectBuffer(Buffer.from("SQLite format 3\u0000rest")).format, "sqlite");
  assert.equal(detectBuffer(Buffer.from('{"messages":[]}')).format, "json");
  assert.equal(detectBuffer(Buffer.from('{"role":"user"}\n{"role":"assistant"}')).format, "jsonl");
  assert.equal(detectBuffer(Buffer.from("<!doctype html><html><body>x</body></html>")).format, "html");
  assert.equal(detectBuffer(Buffer.from("## User\nhello")).format, "markdown");
  assert.equal(detectBuffer(Buffer.from("plain words only")).format, "unknown");
});

test("JSON import supports several message containers and rejects unknown shapes", () => {
  assert.equal(jsonToMessages('{"messages":[{"role":"user","content":"a"}]}').messages.length, 1);
  assert.equal(jsonToMessages('[{"role":"user","content":"a"}]').shape, "array");
  assert.equal(jsonToMessages('{"conversation":{"messages":[{"role":"user","content":"a"}]}}').shape, "conversation.messages");
  assert.throws(() => jsonToMessages('{"nothing":true}'), (error) => error.code === "UNSUPPORTED_SHAPE");
  assert.throws(() => jsonToMessages("{"), (error) => error.code === "INVALID_JSON");
});

test("JSONL keeps malformed lines as unknown records with line evidence", () => {
  const result = parseJsonl('{"role":"user","content":"a"}\nnot json\n');
  assert.equal(result.records.length, 2);
  assert.equal(result.malformed[0].line, 2);
  assert.equal(result.records[1].value.type, "unknown");
  assert.equal(result.records[1].value.raw.line, 2);
  assert.equal(jsonlToMessages('{"role":"user","content":"a"}\n').messages[0].sourceRef, "line:1");
});

test("Markdown reads front matter and speaker headings without dropping text", () => {
  const result = markdownToMessages("---\ntitle: Demo\n---\n## User\nhello\n\n## Assistant\nworld\n");
  assert.equal(result.title, "Demo");
  assert.deepEqual(
    result.messages.map((message) => [message.role, message.content]),
    [
      ["user", "hello"],
      ["assistant", "world"],
    ],
  );
});

test("HTML strips scripts and styles, never executing or keeping them", () => {
  const html = "<html><body><script>alert(1)</script><style>.x{}</style><h2>User</h2><p>hello &amp; bye</p><h2>Assistant</h2><p>ok</p></body></html>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /alert|\.x/);
  assert.match(text, /hello & bye/);
  const result = htmlToMessages(html);
  assert.equal(result.messages.length, 2);
});

test("SQLite reads a real fixture when the runtime exposes node:sqlite", async (t) => {
  const file = path.join(os.tmpdir(), `export-conversation-sqlite-${process.pid}-${Date.now()}.db`);
  t.after(() => fs.rmSync(file, { force: true }));
  const capability = await sqliteCapability();
  if (!capability.available) {
    await assert.rejects(
      readRows(file, "SELECT 1"),
      (error) => error.code === "UNSUPPORTED_RUNTIME",
    );
    return;
  }
  const db = new capability.module.DatabaseSync(file);
  db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT)");
  db.exec("INSERT INTO messages (role, content) VALUES ('user', 'hello')");
  db.exec("INSERT INTO messages (role, content) VALUES ('assistant', 'hi')");
  db.close();

  const tables = await inspectDatabase(file);
  assert.equal(tables[0].name, "messages");
  assert.deepEqual(
    tables[0].columns.map((column) => column.name),
    ["id", "role", "content"],
  );
  const rows = await readRows(file, "SELECT role, content FROM messages ORDER BY id");
  assert.deepEqual(rows.map((row) => row.role), ["user", "assistant"]);
  assert.deepEqual(await tableCounts(file), [{ table: "messages", rows: 2 }]);
});
