/** Markdown transcript reader for heading- and speaker-labelled transcripts. */

const SPEAKER = /^(user|assistant|system|human|ai|tool)$/i;
const HEADING = /^(#{1,4})\s*(?:\*\*)?([A-Za-z][A-Za-z _-]{0,40}?)(?:\*\*)?\s*:?\s*$/;
const BOLD = /^\*\*(user|assistant|system|human|ai|tool)\s*:?\*\*\s*:?\s*(.*)$/i;

function frontMatter(lines) {
  if (lines[0]?.trim() !== "---") return { meta: {}, start: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { meta: {}, start: 0 };
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) meta[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { meta, start: end + 1 };
}

export function markdownToMessages(text) {
  const lines = text.split(/\r?\n/);
  const { meta, start } = frontMatter(lines);
  const messages = [];
  let current = null;
  let lineOffset = start;

  const push = () => {
    if (!current) return;
    const content = current.content.join("\n").trim();
    if (content || current.role !== "unknown") {
      messages.push({
        role: current.role,
        type: "message",
        content,
        timestamp: current.timestamp ?? null,
        id: current.id ?? null,
        sourceRef: `line:${current.line}`,
        line: current.line,
        raw: { heading: current.heading, line: current.line },
        unknown: current.role === "unknown",
      });
    }
    current = null;
  };

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const bold = BOLD.exec(line);
    const heading = HEADING.exec(line);
    let role = null;
    let rest = "";
    let headingText = null;
    if (bold) {
      role = bold[1];
      rest = bold[2] ?? "";
      headingText = line;
    } else if (heading && SPEAKER.test(heading[2].trim())) {
      role = heading[2].trim();
      headingText = line;
      lineOffset = index + 1;
    }
    if (role) {
      push();
      current = {
        role: role.toLowerCase(),
        content: rest ? [rest] : [],
        line: index + 1,
        heading: headingText,
        timestamp: null,
        id: null,
      };
    } else if (current) {
      current.content.push(line);
    }
  }
  push();

  if (messages.length === 0 && text.trim()) {
    messages.push({
      role: "unknown",
      type: "unknown",
      content: text.trim(),
      timestamp: null,
      id: null,
      sourceRef: `line:${start + 1}`,
      unknown: true,
      raw: { fallback: true },
    });
  }

  return {
    messages,
    title: meta.title ?? meta.conversation ?? null,
    meta,
    lineOffset,
  };
}
