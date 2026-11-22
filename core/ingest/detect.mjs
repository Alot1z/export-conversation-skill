/** Format detection from bytes, never from a file extension alone. */

import fs from "node:fs";

export const INPUT_LIMIT_BYTES = 256 * 1024 * 1024;

export class InputError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InputError";
    this.code = code;
    this.details = details;
  }
}

export function readInput(inputPath, options = {}) {
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    throw new InputError("INPUT_NOT_FOUND", `input does not exist: ${inputPath}`);
  }
  if (!stat.isFile()) throw new InputError("INPUT_NOT_FILE", `input is not a file: ${inputPath}`);
  const limit = options.limit ?? INPUT_LIMIT_BYTES;
  if (stat.size > limit) {
    throw new InputError("INPUT_TOO_LARGE", `input exceeds ${limit} bytes: ${inputPath}`);
  }
  return fs.readFileSync(inputPath);
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeJsonl(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (lines.length === 0) return false;
  return lines.every((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object";
    } catch {
      return false;
    }
  });
}

export function detectBuffer(buffer, options = {}) {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    return { format: "zip", confidence: 1, reason: "local file header signature" };
  }
  if (buffer.subarray(0, 16).toString("utf8") === "SQLite format 3\u0000") {
    return { format: "sqlite", confidence: 1, reason: "SQLite header" };
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { format: "gzip", confidence: 1, reason: "gzip magic" };
  }
  const text = buffer.toString("utf8");
  const start = text.trimStart().slice(0, 200).toLowerCase();
  if (start.startsWith("<!doctype html") || start.startsWith("<html") || start.includes("<body")) {
    return { format: "html", confidence: 0.95, reason: "HTML document markers" };
  }
  if (looksLikeJson(text)) {
    return { format: "json", confidence: 0.9, reason: "whole input parses as JSON" };
  }
  if (looksLikeJsonl(text)) {
    return { format: "jsonl", confidence: 0.9, reason: "first lines parse as JSON objects" };
  }
  if (/^#{1,3}\s+\S/m.test(text) || /\*\*(user|assistant|system)\*\*/i.test(text)) {
    return { format: "markdown", confidence: 0.7, reason: "Markdown headings or speaker labels" };
  }
  return {
    format: options.fallback ?? "unknown",
    confidence: 0,
    reason: "no known signature matched",
  };
}

export function detectInput(inputPath, options = {}) {
  const buffer = readInput(inputPath, options);
  return { ...detectBuffer(buffer, options), bytes: buffer.length, buffer };
}
