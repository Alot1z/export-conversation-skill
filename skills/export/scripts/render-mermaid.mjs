#!/usr/bin/env node
/**
 * Render and validate every fenced Mermaid block in a Markdown file.
 *
 * Usage:
 *   node render-mermaid.mjs <file.md> [options]
 *
 * Options:
 *   --out <dir>        Output directory (default: target/mermaid)
 *   --no-png           Render SVG only
 *   --offline          Require a local mmdc; never invoke npx
 *   --mmdc <path>      Renderer executable (default: MMDC, node_modules, npx)
 *   --timeout <ms>      Per-render timeout (default: 120000)
 *   --jobs <n>         Render n diagrams concurrently (default: 1, max: 4)
 *   --strict-layout    Treat layout warnings as failures
 *   --strict-lint      Treat lint warnings as failures
 *   --max-diagrams <n> Diagram budget (default: 8)
 *   --gallery          Write index.html with PNGs, sources and warnings
 *   --manifest <file>  Write a JSON render manifest
 *   --json             Print the manifest instead of the table
 *
 * Uses MMDC, a local node_modules/.bin/mmdc, or npx @mermaid-js/mermaid-cli
 * pinned to 12.2.0. A local Chrome/Edge is used when available; otherwise
 * Mermaid CLI's bundled browser.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const VERSION = "2.2.1";
const CLI = "@mermaid-js/mermaid-cli@12.2.0";
const WINDOWS = process.platform === "win32";
const SCRIPT = basename(process.argv[1] ?? "render-mermaid.mjs");

const USAGE = `Usage: node ${SCRIPT} [file.md] [options]

Options:
  --out <dir>        Output directory (default: target/mermaid)
  --no-png           Render SVG only; skip PNG visual-review output
  --offline          Require a local mmdc; never invoke npx
  --mmdc <path>      Renderer executable (default: MMDC, node_modules, npx)
  --timeout <ms>     Per-render timeout (default: 120000)
  --jobs <n>         Render n diagrams concurrently (default: 1, max: 4)
  --strict-layout    Treat layout warnings as failures
  --strict-lint      Treat lint warnings as failures
  --max-diagrams <n> Diagram budget (default: 8)
  --gallery          Write index.html with PNGs, sources and warnings
  --manifest <file>  Write a JSON render manifest
  --json             Print the manifest instead of the table
  -h, --help         Show this help

Without a file, the newest conversation-export-*.md in the current directory is used.`;

const TYPES = new Set([
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "architecture-beta",
  "kanban",
  "radar-beta",
  "treemap-beta",
]);

export function parseArgs(argv) {
  const options = {
    file: null,
    outDir: "target/mermaid",
    png: true,
    offline: false,
    mmdc: null,
    timeout: 120000,
    jobs: 1,
    strictLayout: false,
    strictLint: false,
    maxDiagrams: 8,
    gallery: false,
    manifest: null,
    json: false,
    help: false,
  };

  const take = (arg, name) => {
    const value = arg === name ? argv[++options.index] : arg.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return value;
  };

  for (options.index = 0; options.index < argv.length; options.index += 1) {
    const arg = argv[options.index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-png") options.png = false;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--gallery") options.gallery = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--strict-layout") options.strictLayout = true;
    else if (arg === "--strict-lint") options.strictLint = true;
    else if (arg === "--out" || arg.startsWith("--out=")) options.outDir = take(arg, "--out");
    else if (arg === "--mmdc" || arg.startsWith("--mmdc=")) options.mmdc = take(arg, "--mmdc");
    else if (arg === "--timeout" || arg.startsWith("--timeout=")) options.timeout = Number(take(arg, "--timeout"));
    else if (arg === "--jobs" || arg.startsWith("--jobs=")) options.jobs = Number(take(arg, "--jobs"));
    else if (arg === "--max-diagrams" || arg.startsWith("--max-diagrams=")) options.maxDiagrams = Number(take(arg, "--max-diagrams"));
    else if (arg === "--manifest" || arg.startsWith("--manifest=")) options.manifest = take(arg, "--manifest");
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Pass one Markdown file at a time");
    else options.file = arg;
  }

  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error("--timeout must be a positive number");
  if (!Number.isInteger(options.jobs) || options.jobs < 1) throw new Error("--jobs must be a positive integer");
  options.jobs = Math.min(options.jobs, 4);
  if (!Number.isInteger(options.maxDiagrams) || options.maxDiagrams < 1) throw new Error("--max-diagrams must be a positive integer");
  delete options.index;
  return options;
}

/**
 * Quote one token for the platform shell. spawn receives a single command
 * string (not args with shell: true), so spaces and shell metacharacters in
 * file names must be quoted here. Exported for tests.
 */
export function quoteFor(value, windows = WINDOWS) {
  if (!/[\s"&|<>^()'$`\\]/.test(value)) return value;
  return windows
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function quote(value) {
  return quoteFor(value);
}

function outputOf(result) {
  return [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function runSync(command, cwd, timeout) {
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { ok: result.status === 0, output: outputOf(result) };
}

function runAsync(command, cwd, timeout) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ ok, output: [stdout, stderr].filter(Boolean).join("\n").trim() });
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      stderr += `\nTimed out after ${timeout} ms`;
      finish(false);
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}

export function extractBlocks(source) {
  return [...source.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((match, index) => ({
    index: index + 1,
    line: source.slice(0, match.index).split("\n").length,
    body: match[1].replace(/\r\n/g, "\n").trim(),
  }));
}

export function lintBlock(body) {
  const warnings = [];
  const lines = body.split("\n").filter((line) => line.trim() && !line.trim().startsWith("%%"));
  const first = lines[0]?.trim() ?? "";
  const type = first.split(/\s+/)[0] || "unknown";

  if (!TYPES.has(type)) warnings.push(`unknown or unsupported diagram type "${type}"`);
  if (type === "graph") warnings.push('use "flowchart" instead of "graph" for new diagrams');
  if (type === "classDiagram" || type === "stateDiagram") warnings.push(`prefer ${type}-v2 when supported`);
  if (/\[\s*\]|\(\s*\)|\{\s*\}/.test(body)) warnings.push("empty node label");
  if (lines.length > 80) warnings.push(`diagram has ${lines.length} lines; consider splitting it`);
  if (/\b(undefined|null)\b/.test(body)) warnings.push("diagram text contains undefined/null");

  return { type, warnings };
}

export function analyzeSvg(svg) {
  const match = svg.match(/viewBox="([^"]+)"/);
  const box = match?.[1].trim().split(/\s+/).map(Number);
  const width = box?.[2] ?? null;
  const height = box?.[3] ?? null;
  const aspect = width && height ? width / height : null;
  const warnings = [];

  if (/Syntax error/i.test(svg)) warnings.push("Mermaid reported a syntax error");
  if (/NaN|Infinity/.test(match?.[1] ?? "")) warnings.push("viewBox contains NaN or Infinity");
  if (aspect && aspect > 8) warnings.push(`extreme aspect ratio ${aspect.toFixed(2)} (${width}x${height})`);
  if (width && width > 2400) warnings.push(`diagram is very wide (${width}px)`);
  if (height && height > 2400) warnings.push(`diagram is very tall (${height}px)`);
  if (!/<text|<foreignObject/i.test(svg)) warnings.push("no text elements rendered");

  return { width, height, aspect: aspect ? Number(aspect.toFixed(2)) : null, warnings };
}

export function resolveRenderer(options, root) {
  const explicit = options.mmdc || process.env.MMDC;
  if (explicit) return { command: quote(explicit), label: explicit, local: true };

  const binary = join(root, "node_modules", ".bin", WINDOWS ? "mmdc.cmd" : "mmdc");
  if (existsSync(binary)) return { command: quote(binary), label: binary, local: true };

  if (options.offline) {
    throw new Error("No local mmdc found; install @mermaid-js/mermaid-cli or drop --offline");
  }

  return { command: `npx --yes ${CLI}`, label: `npx ${CLI}`, local: false };
}

function defaultMarkdownPath(root) {
  const exports = readdirSync(root)
    .filter((name) => /^conversation-export-.*\.md$/i.test(name))
    .sort();
  return exports.length > 0 ? resolve(root, exports.at(-1)) : null;
}

function findBrowser() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeGallery(outDir, results, sourceName) {
  const cards = results
    .map((result) => {
      const warnings = result.warnings.length
        ? `<ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : "<p class=\"ok\">No warnings</p>";
      const image = result.png
        ? `<img src="diagram-${String(result.index).padStart(2, "0")}.png" alt="${escapeHtml(result.type)} diagram ${result.index}">`
        : "<p>PNG skipped</p>";
      const source = readFileSync(result.input, "utf8");
      return `<section><h2>Diagram ${result.index} - ${escapeHtml(result.type)}</h2>${image}<p>${result.width}x${result.height} · ${result.failed ? "FAIL" : "ok"}</p>${warnings}<pre>${escapeHtml(source)}</pre></section>`;
    })
    .join("\n");

  writeFileSync(
    join(outDir, "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mermaid review - ${escapeHtml(sourceName)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem;max-width:1100px}section{border-top:1px solid #ddd;padding:1rem 0}img{max-width:100%;border:1px solid #eee}pre{background:#f6f6f6;padding:1rem;overflow:auto}.ok{color:#176b2c}ul{color:#8a4b00}</style>
</head><body><h1>Mermaid review</h1><p>${escapeHtml(sourceName)} · ${results.length} diagram(s)</p>${cards}</body></html>\n`,
  );
}

function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const root = process.cwd();
  const markdownPath = options.file ? resolve(root, options.file) : defaultMarkdownPath(root);

  if (!markdownPath) {
    console.error(`No file given and no conversation-export-*.md found in ${root}.\n\n${USAGE}`);
    process.exit(1);
  }
  if (!existsSync(markdownPath)) {
    console.error(`Markdown file not found: ${markdownPath}`);
    process.exit(1);
  }

  const source = readFileSync(markdownPath, "utf8");
  const blocks = extractBlocks(source);
  if (blocks.length === 0) {
    console.error(`No fenced mermaid blocks found in ${relative(root, markdownPath)}`);
    process.exit(1);
  }

  const outDir = resolve(root, options.outDir);
  mkdirSync(outDir, { recursive: true });

  const browser = findBrowser();
  const configPath = join(outDir, "puppeteer.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...(browser ? { executablePath: browser } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
      null,
      2,
    )}\n`,
  );

  const renderer = resolveRenderer(options, root);
  const rel = (path) => relative(root, path);
  const rendererVersion = runSync(`${renderer.command} --version`, root, options.timeout)
    .output.split(/\r?\n/)
    .pop()
    .trim() || "unknown";

  const lint = blocks.map((block) => lintBlock(block.body));
  const budgetWarning =
    blocks.length > options.maxDiagrams
      ? `${blocks.length} diagrams exceed the budget of ${options.maxDiagrams}`
      : null;

  const renderOne = async (block) => {
    const stem = join(outDir, `diagram-${String(block.index).padStart(2, "0")}`);
    const input = `${stem}.mmd`;
    const svgPath = `${stem}.svg`;
    const pngPath = `${stem}.png`;
    writeFileSync(input, `${block.body}\n`);

    const render = (output, extra = []) => {
      const args = ["-i", rel(input), "-o", rel(output), ...extra, "-b", "white", "-p", rel(configPath)];
      return runAsync(`${renderer.command} ${args.map(quote).join(" ")}`, root, options.timeout);
    };

    const svg = await render(svgPath);
    const png = options.png ? await render(pngPath, ["-e", "png", "--size", "1600"]) : { ok: true, output: "" };
    const info = existsSync(svgPath)
      ? analyzeSvg(readFileSync(svgPath, "utf8"))
      : { width: null, height: null, aspect: null, warnings: ["SVG was not written"] };

    const lintWarnings = lint[block.index - 1].warnings;
    const layoutWarnings = info.warnings;
    const warnings = [...lintWarnings, ...layoutWarnings];
    const failed =
      !svg.ok ||
      !existsSync(svgPath) ||
      !png.ok ||
      (options.png && !existsSync(pngPath));
    const strictFailure =
      (options.strictLayout && layoutWarnings.length > 0) ||
      (options.strictLint && lintWarnings.length > 0);

    return {
      index: block.index,
      line: block.line,
      type: lint[block.index - 1].type,
      input,
      width: info.width,
      height: info.height,
      aspect: info.aspect,
      warnings,
      lintWarnings,
      layoutWarnings,
      svg: svg.ok,
      png: options.png ? png.ok : null,
      failed,
      strictFailure,
      output: [svg.output, png.output].filter(Boolean).join("\n"),
    };
  };

  const results = await pool(blocks, options.jobs, renderOne);

  const failures = results.filter((result) => result.failed || result.strictFailure);

  const manifest = {
    tool: "render-mermaid",
    version: VERSION,
    source: rel(markdownPath),
    generatedAt: new Date().toISOString(),
    renderer: renderer.label,
    rendererVersion,
    browser: browser ?? "bundled fallback",
    budgetWarning,
    ok: failures.length === 0,
    diagrams: results.map(({ output, input, strictFailure, ...result }) => result),
  };

  if (options.manifest) writeManifest(resolve(root, options.manifest), manifest);
  if (options.gallery) writeGallery(outDir, results, rel(markdownPath));

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(`Mermaid CLI ${rendererVersion}`);
    console.log(`Source: ${rel(markdownPath)}`);
    console.log(`Output: ${rel(outDir)}`);
    console.log(`Browser: ${browser ?? "bundled fallback"}`);
    console.log(`Renderer: ${renderer.label}${renderer.local ? " (local)" : " (npx)"}`);
    if (budgetWarning) console.log(`Warning: ${budgetWarning}`);
    console.log("");
    console.log("| # | line | type | SVG | PNG | viewBox | aspect | warnings |");
    console.log("|---|------|------|-----|-----|---------|--------|----------|");

    for (const result of results) {
      const viewBox = result.width && result.height ? `${result.width}x${result.height}` : "unknown";
      const png = result.png === null ? "skipped" : result.png ? "ok" : "FAIL";
      console.log(
        `| ${result.index} | ${result.line} | ${result.type} | ${result.svg ? "ok" : "FAIL"} | ${png} | ${viewBox} | ${result.aspect ?? "unknown"} | ${result.warnings.length} |`,
      );
    }
  }

  if (failures.length > 0) {
    if (!options.json) {
      console.error(`\n${failures.length} of ${results.length} diagram(s) failed or violated a strict check.`);
      for (const failure of failures) {
        console.error(`\n--- diagram ${failure.index} (line ${failure.line}) ---`);
        for (const warning of failure.warnings) console.error(`warning: ${warning}`);
        if (failure.output) console.error(failure.output.split(/\r?\n/).slice(-20).join("\n"));
      }
    }
    process.exit(1);
  }

  if (!options.json) {
    console.log(`\nAll ${results.length} Mermaid diagrams rendered successfully.`);
    console.log("Inspect the PNGs (or index.html with --gallery) for clipped labels and overlapping tags.");
  }
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && (WINDOWS ? invoked.toLowerCase() === self.toLowerCase() : invoked === self)) {
  main();
}
