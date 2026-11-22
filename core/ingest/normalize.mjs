/** Shared normalization for message-shaped source values. */

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (part?.type === "input_text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    return JSON.stringify(content);
  }
  return content === undefined || content === null ? "" : String(content);
}

const ROLE_ALIASES = {
  human: "user",
  user: "user",
  assistant: "assistant",
  ai: "assistant",
  model: "assistant",
  gemini: "assistant",
  system: "system",
  developer: "system",
  tool: "tool",
  function: "tool",
};

export function normalizeRole(value) {
  if (!value) return "unknown";
  const key = String(value).toLowerCase().trim();
  return ROLE_ALIASES[key] ?? key;
}

export function messageFromValue(value) {
  if (!value || typeof value !== "object") {
    return {
      role: "unknown",
      type: "unknown",
      content: String(value ?? ""),
      timestamp: null,
      id: null,
      unknown: true,
      raw: value,
    };
  }
  const roleSource = value.role ?? value.author ?? value.sender ?? value.speaker ?? value.from;
  const content =
    value.content ?? value.text ?? value.message ?? value.body ?? value.parts ?? value.output;
  const role = normalizeRole(roleSource);
  const hasContent = content !== undefined && content !== null;
  const type = value.type === "unknown" ? "unknown" : value.type ?? "message";
  return {
    role,
    type,
    content: hasContent ? textFromContent(content) : textFromContent(value),
    timestamp: value.timestamp ?? value.created_at ?? value.time ?? value.date ?? null,
    id: value.id ?? value.uuid ?? value.message_id ?? null,
    unknown: role === "unknown" || !hasContent,
    raw: value,
  };
}

export function normalizeMessages(values) {
  return values.map((value, index) => ({
    ...messageFromValue(value),
    sourceRef: value?.id ?? value?.uuid ?? `index:${index}`,
  }));
}
