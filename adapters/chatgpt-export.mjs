/**
 * ChatGPT data export ZIP. Uses the mapping tree's current_node active path and
 * reports alternative branches instead of flattening them.
 */

import { readInput } from "../core/ingest/detect.mjs";
import { readZip } from "../core/ingest/zip.mjs";
import { branchPath, resolveActiveTip } from "../core/reconstruct.mjs";
import { capabilities, finalizeCapture } from "./util.mjs";

function findConversationsFile(files) {
  const names = [...files.keys()].filter((name) => !name.includes("/"));
  const direct = names.find((name) => /^conversations\.json$/i.test(name));
  if (direct) return direct;
  return names.find((name) => /^conversations.*\.json$/i.test(name)) ?? null;
}

function messageText(content) {
  if (!content || typeof content !== "object") return "";
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export default {
  id: "chatgpt-export",
  version: "1.0.0",
  harness: "chatgpt",
  kind: "official-export",
  evidence: "synthetic-fixture",
  capabilities: capabilities({
    system: true,
    attachments: true,
    timestamps: true,
    originalIds: true,
    fullHistory: true,
  }),
  async capture({ input, options = {} }) {
    const archive = readZip(readInput(input));
    const name = findConversationsFile(archive.files);
    if (!name) throw new Error("ChatGPT export does not contain conversations.json");
    const conversations = JSON.parse(archive.files.get(name).toString("utf8"));
    if (!Array.isArray(conversations)) throw new Error("conversations.json is not an array");
    const selected =
      conversations.find(
        (conversation) =>
          conversation.conversation_id === options.conversationId ||
          conversation.id === options.conversationId,
      ) ?? conversations[0];
    if (!selected) throw new Error("ChatGPT export contains no conversations");

    const mapping = selected.mapping ?? {};
    const nodes = {};
    for (const [id, node] of Object.entries(mapping)) nodes[id] = { ...node, id };
    const tip = resolveActiveTip(nodes, selected.current_node);
    const activePath = branchPath(nodes, tip);
    const records = [];
    const attachments = [];
    let seq = 0;

    for (const node of activePath) {
      const message = node.message;
      if (!message) continue;
      const role = message.author?.role ?? "unknown";
      const contentType = message.content?.content_type ?? "text";
      const text = messageText(message.content);
      const timestamp = message.create_time
        ? new Date(message.create_time * 1000).toISOString()
        : null;
      if (contentType !== "text" && !text) {
        records.push({
          seq: seq++,
          role,
          type: "unknown",
          content: JSON.stringify(message.content ?? null),
          timestamp,
          provenance: "IMPORTED",
          sourceRef: node.id,
          parentId: node.parent ?? null,
          unknown: true,
          status: `content_type:${contentType}`,
          raw: message,
        });
      } else {
        records.push({
          seq: seq++,
          role,
          type: role === "tool" ? "tool_result" : "message",
          content: text,
          timestamp,
          provenance: "IMPORTED",
          sourceRef: node.id,
          parentId: node.parent ?? null,
          toolCallId: message.metadata?.tool_call_id ?? null,
          raw: message,
        });
      }
      for (const part of message.content?.parts ?? []) {
        if (part && typeof part === "object" && part.asset_pointer) {
          attachments.push({
            name: part.asset_pointer.split("/").at(-1) ?? "asset",
            mediaType: part.content_type ?? "application/octet-stream",
            path: null,
            sha256: null,
            status: "unavailable",
          });
        }
      }
    }

    const alternatives = Object.keys(nodes).length - activePath.length;
    const conversationId =
      options.conversationId ??
      `chatgpt-${String(selected.conversation_id ?? selected.id ?? "export").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    return finalizeCapture({
      adapter: this,
      inputPath: input,
      conversation: { id: conversationId, title: options.title ?? selected.title },
      records,
      attachments,
      boundary: {
        kind: "official-export-active-branch",
        total_known: true,
        total_records: records.length,
        records_available: records.length,
        history_complete: true,
      },
      warnings:
        alternatives > 0
          ? [`${alternatives} alternative branch node(s) are preserved in the source and not rendered`]
          : [],
      capabilities: this.capabilities,
      options: { ...options, conversationId, title: selected.title },
    });
  },
};
