import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { project } from "./helpers/harness.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SERVER = path.join(ROOT, "scripts", "mcp-server.mjs");

function runMcp(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    for (const line of lines) child.stdin.write(`${line}\n`);
    child.stdin.end();
  });
}

test("MCP self-test proves the handshake, tools and error surface", () => {
  const result = spawnSync(process.execPath, [SERVER, "--self-test"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.tools, 11);
  assert.equal(report.checks.unknownMethod, true);
});

test("MCP stdio answers initialize, tools/list, tools/call and rejects malformed input", async (t) => {
  const root = project(t, "mcp");
  const responses = await runMcp([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "conversation_list", arguments: { project: root } },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "conversation_get", arguments: {} },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 5, method: "no/such" }),
    "{",
  ]);
  assert.equal(responses.code, 0, responses.stderr);
  const messages = responses.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(messages.length, 6);
  assert.equal(messages[0].result.serverInfo.version, "3.0.0");
  assert.equal(messages[1].result.tools.length, 11);
  assert.equal(messages[2].result.isError, false);
  assert.match(messages[2].result.content[0].text, /conversations/);
  assert.equal(messages[3].result.isError, true);
  assert.match(messages[3].result.content[0].text, /error/);
  assert.equal(messages[4].error.code, -32601);
  assert.equal(messages[5].error.code, -32700);
});

test("MCP notifications produce no response", async () => {
  const responses = await runMcp([
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
  ]);
  const messages = responses.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 9);
  assert.deepEqual(messages[0].result, {});
});
