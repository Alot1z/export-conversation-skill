#!/usr/bin/env node
/**
 * Copy local images referenced by an export into an assets folder and rewrite
 * the links. Remote images are left alone.
 *
 * Usage:
 *   node assets.mjs <file.md> [--write] [--out-dir <dir>] [--json]
 *
 * Default is check mode. --write performs the copy and rewrite.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

export const VERSION = "2.2.0";

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

function isRemote(target) {
  return /^(?:https?:|data:|mailto:|#)/i.test(target);
}

function altFromPath(path) {
  return basename(path, extname(path)).replace(/[-_]+/g, " ").trim() || "image";
}

export function collectImages(text, markdownPath) {
  const baseDir = dirname(resolve(markdownPath));
  const images = [];
  for (const match of text.matchAll(IMAGE)) {
    const [whole, alt, target, title] = match;
    if (isRemote(target)) continue;
    const absolute = resolve(baseDir, target);
    images.push({ whole, alt, target, title: title ?? "", absolute, exists: existsSync(absolute) });
  }
  return images;
}

export function rewriteAssets(text, markdownPath, outDir) {
  const baseDir = dirname(resolve(markdownPath));
  const assetsDir = outDir ? resolve(outDir) : join(baseDir, `${basename(markdownPath, extname(markdownPath))}-assets`);
  const used = new Map();
  const copied = [];
  const missing = [];
  let rewritten = 0;

  const result = text.replace(IMAGE, (whole, alt, target, title = "") => {
    if (isRemote(target)) return whole;
    const absolute = resolve(baseDir, target);
    if (!existsSync(absolute)) {
      missing.push(target);
      return whole;
    }

    let name = basename(target);
    const extension = extname(name);
    const stem = basename(name, extension).replace(/[^A-Za-z0-9._-]+/g, "-");
    let candidate = `${stem}${extension}`;
    let counter = 2;
    while (used.has(candidate)) candidate = `${stem}-${counter++}${extension}`;
    used.set(candidate, true);

    mkdirSync(assetsDir, { recursive: true });
    const destination = join(assetsDir, candidate);
    copyFileSync(absolute, destination);
    copied.push(relative(baseDir, destination).replaceAll("\\", "/"));

    const link = relative(baseDir, destination).replaceAll("\\", "/");
    const altText = alt.trim() || altFromPath(target);
    rewritten += 1;
    const titleSuffix = title || "";
    return `![${altText}](${link}${titleSuffix})`;
  });

  return { text: result, copied, missing, rewritten, assetsDir };
}

function parseArgs(argv) {
  const options = { file: null, write: false, outDir: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--write") options.write = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--out-dir" || arg.startsWith("--out-dir=")) {
      options.outDir = arg.startsWith("--out-dir=") ? arg.slice("--out-dir=".length) : value();
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Pass one Markdown file at a time");
    else options.file = arg;
  }
  return options;
}

function main() {
  const usage = "Usage: node assets.mjs <file.md> [--write] [--out-dir <dir>] [--json]";
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(1);
  }

  if (options.help || !options.file) {
    console.log(usage);
    process.exit(options.help ? 0 : 1);
  }

  const text = readFileSync(options.file, "utf8");
  const images = collectImages(text, options.file);
  const missing = images.filter((image) => !image.exists);
  const local = images.filter((image) => image.exists);

  let result = null;
  if (options.write) {
    result = rewriteAssets(text, options.file, options.outDir);
    writeFileSync(options.file, result.text);
  }

  const report = {
    file: basename(options.file),
    mode: options.write ? "write" : "check",
    localImages: local.length,
    missing: missing.map((image) => image.target),
    copied: result?.copied ?? [],
    rewritten: result?.rewritten ?? 0,
    assetsDir: result?.assetsDir ?? null,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${options.write ? "Rewrote" : "Found"} ${local.length} local image(s), ${missing.length} missing.`);
    if (result) console.log(`Assets: ${result.assetsDir} (${result.copied.length} copied)`);
    for (const image of missing) console.log(`missing: ${image.target}`);
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

const self = basename(new URL(import.meta.url).pathname);
const invoked = process.argv[1] ? basename(process.argv[1]) : "";
if (invoked && decodeURIComponent(self) === invoked) {
  main();
}
