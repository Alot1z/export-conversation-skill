#!/usr/bin/env node
/** Dependency-free MCP stdio server over the same core engine as the CLI. */

import { createInterface } from "node:readline";
import "../adapters/index.mjs";
import { listAdapters } from "../core/registry.mjs";
import { listConversations, readConversation } from "../core/store.mjs";
import {
  discoverSources,
  importConversation,
  migrate,
  readCatalogue,
  recoverStore,
  renderExport,
  search,
  verify,
} from "../core/service.mjs";

const VERSION = "3.0.0";
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "conversation_list",
    description: "List conversation exports in a project's .export store with dimensioned coverage.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project root; defaults to the server cwd" } },
    },
  },
  {
    name: "conversation_get",
    description: "Read one conversation's metadata, coverage, warnings and record count.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, project: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "conversation_search",
    description: "Search message content across a project's conversations.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        role: { type: "string" },
        adapter: { type: "string" },
        limit: { type: "number" },
        project: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "conversation_verify",
    description: "Run dimensioned verification for one conversation or the whole project store.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, project: { type: "string" } },
    },
  },
  {
    name: "conversation_import",
    description: "Capture one readable source through a registered adapter into the project store.",
    inputSchema: {
      type: "object",
      properties: {
        adapter: { type: "string" },
        input: { type: "string" },
        id: { type: "string" },
        title: { type: "string" },
        source_ref: { type: "string" },
        complete: { type: "boolean" },
        project: { type: "string" },
      },
      required: ["adapter", "input"],
    },
  },
  {
    name: "conversation_export",
    description: "Render one stored conversation as Markdown, JSON or HTML and return its content.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        format: { type: "string", enum: ["md", "json", "html"] },
        project: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "conversation_adapters",
    description: "List registered adapters with capabilities and evidence class.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conversation_catalogue",
    description: "Return the offline harness catalogue.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conversation_discover",
    description: "Find readable harness session files under a root without modifying them.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
    },
  },
  {
    name: "conversation_migrate",
    description: "Migrate schema-1 (2.2.x) exports to schema 2 with verified backups.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, all: { type: "boolean" }, project: { type: "string" } },
    },
  },
  {
    name: "conversation_recover",
    description: "Roll back interrupted store transactions and regenerate the project index.",
    inputSchema: { type: "object", properties: { project: { type: "string" } } },
  },
];

function textResult(payload, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function dispatch(name, args = {}) {
  const project = args.project ?? process.cwd();
  switch (name) {
    case "conversation_list":
      return { conversations: listConversations(project) };
    case "conversation_get": {
      const conversation = readConversation(project, args.id);
      return {
        metadata: conversation.metadata,
        coverage: conversation.metadata.coverage,
        records: conversation.view?.records?.length ?? 0,
        warnings: conversation.view?.warnings ?? [],
      };
    }
    case "conversation_search":
      return search(project, {
        text: args.text,
        role: args.role,
        adapter: args.adapter,
        limit: args.limit,
      });
    case "conversation_verify":
      return verify(project, args.id ?? null);
    case "conversation_import":
      return importConversation({
        project,
        adapter: args.adapter,
        input: args.input,
        id: args.id,
        title: args.title,
        sourceRef: args.source_ref,
        complete: args.complete,
      });
    case "conversation_export": {
      const rendered = renderExport(project, args.id, args.format ?? "md");
      return rendered;
    }
    case "conversation_adapters":
      return { adapters: listAdapters() };
    case "conversation_catalogue":
      return readCatalogue();
    case "conversation_discover":
      return discoverSources(args.root);
    case "conversation_migrate":
      return migrate(project, { id: args.id, all: args.all === true });
    case "conversation_recover":
      return recoverStore(project);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: -32600, message: "invalid JSON-RPC request" },
    };
  }
  if (request.method.startsWith("notifications/")) return null;
  if (request.id === undefined) return null;

  try {
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "export-conversation", version: VERSION },
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id: request.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } };
      case "tools/call": {
        const name = request.params?.name;
        if (!name) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32602, message: "tools/call requires params.name" },
          };
        }
        try {
          const payload = await dispatch(name, request.params?.arguments ?? {});
          return { jsonrpc: "2.0", id: request.id, result: textResult(payload) };
        } catch (error) {
          return { jsonrpc: "2.0", id: request.id, result: textResult({ error: error.message }, true) };
        }
      }
      case "shutdown":
        return { jsonrpc: "2.0", id: request.id, result: null };
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `method not found: ${request.method}` },
        };
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error.message },
    };
  }
}

async function selfTest() {
  const initialize = await handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const tools = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const adapters = await handleRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "conversation_adapters", arguments: {} },
  });
  const malformed = await handleRequest({ jsonrpc: "2.0", id: 4, method: "no/such" });
  const checks = {
    initialize: initialize?.result?.serverInfo?.name === "export-conversation",
    tools: tools?.result?.tools?.length === TOOLS.length,
    adapters: adapters?.result?.isError === false,
    unknownMethod: malformed?.error?.code === -32601,
  };
  const ok = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ ok, protocol: PROTOCOL_VERSION, tools: TOOLS.length, checks })}\n`);
  return ok ? 0 : 1;
}

async function serve() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    chain = chain.then(async () => {
      if (!line.trim()) return;
      let request;
      try {
        request = JSON.parse(line);
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`,
        );
        return;
      }
      const response = await handleRequest(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise((resolve) => rl.on("close", resolve));
  await chain;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  const code = await selfTest();
  process.exit(code);
} else if (args.includes("--help")) {
  process.stdout.write("MCP stdio server for export-conversation 3.0.0. Use --self-test to verify.\n");
} else {
  serve().catch((error) => {
    process.stderr.write(`mcp-server error: ${error.message}\n`);
    process.exit(1);
  });
}
