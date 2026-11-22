/** Generic JSON conversation reader with explicit shape detection. */

import { normalizeMessages } from "./normalize.mjs";

export class JsonInputError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "JsonInputError";
    this.code = code;
    this.details = details;
  }
}

function findMessages(parsed) {
  if (Array.isArray(parsed)) return { messages: parsed, shape: "array" };
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed.messages)) return { messages: parsed.messages, shape: "messages" };
  if (Array.isArray(parsed.conversation?.messages)) {
    return { messages: parsed.conversation.messages, shape: "conversation.messages" };
  }
  if (Array.isArray(parsed.chat?.messages)) return { messages: parsed.chat.messages, shape: "chat.messages" };
  if (Array.isArray(parsed.data?.messages)) return { messages: parsed.data.messages, shape: "data.messages" };
  if (Array.isArray(parsed.thread?.messages)) {
    return { messages: parsed.thread.messages, shape: "thread.messages" };
  }
  return null;
}

export function jsonToMessages(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new JsonInputError("INVALID_JSON", `input is not valid JSON: ${error.message}`);
  }
  const found = findMessages(parsed);
  if (!found) {
    throw new JsonInputError(
      "UNSUPPORTED_SHAPE",
      "JSON does not contain a messages array in a supported location",
    );
  }
  return {
    messages: normalizeMessages(found.messages),
    title:
      parsed.title ??
      parsed.conversation?.title ??
      parsed.chat?.title ??
      parsed.thread?.title ??
      null,
    conversationId:
      parsed.id ?? parsed.conversation?.id ?? parsed.chat?.id ?? parsed.thread?.id ?? null,
    shape: found.shape,
    warnings: [],
  };
}
