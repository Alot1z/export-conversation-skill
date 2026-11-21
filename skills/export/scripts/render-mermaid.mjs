#!/usr/bin/env node
/**
 * Render every fenced Mermaid block in a Markdown file.
 *
 * Usage:
 *   node render-mermaid.mjs <file.md> [--out <dir>] [--no-png]
 *
 * Writes one .mmd plus an SVG (and PNG unless --no-png) per block, prints a
 * size table, and exits non-zero if any block fails to render. A local
 * Chrome/Edge is used when present; otherwise Mermaid CLI's bundled browser.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CLI = "@mermaid-js/mermaid-cli@12";
const WINDOWS = process.platform === "win32";
const SCRIPT = basename(process.argv[1] ?? "render-mermaid.mjs");

const USAGE = `Usage: node ${SCRIPT} [file.md] [options]

Options:
  --out <dir>   Output directory (default: target/mermaid)
  --no-png      Render SVG only; skip PNG visual-review output
  -h, --help    Show this help

Without a file, the newest conversation-export-*.md in the current directory is used.`;

function parseArgs(argv) {
  const options = { file: null, outDir: "target/mermaid", png: true, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--no-png") {
      options.png = false;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg === "--out" ? argv[++index] : arg.slice("--out=".length);
      if (!value) throw new Error("--out requires a directory");
      options.outDir = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.file) {
      throw new Error("Pass one Markdown file at a time");
    } else {
      options.file = arg;
    }
  }

  return options;
}

/**
 * Quote one token for the platform shell. spawnSync receives a single command
 * string (not args with shell: true), so spaces and shell metacharacters in
 * file names must be quoted here.
 */
function quote(value) {
  if (!/[\s"&|<>^()]/.test(value)) return value;
  return WINDOWS
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function run(args, cwd) {
  const command = ["npx", ...args].map(quote).join(" ");
  const result = spawnSync(command, { cwd, encoding: "utf8", shell: true });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n")
    .trim();
  return { ok: result.status === 0, output };
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

function dimensionsOf(svgPath) {
  const svg = readFileSync(svgPath, "utf8");
  const box = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  return {
    width: box?.[2] ?? null,
    height: box?.[3] ?? null,
    syntaxError: /Syntax error/i.test(svg),
  };
}

function defaultMarkdownPath(root) {
  const exports = readdirSync(root)
    .filter((name) => /^conversation-export-.*\.md$/i.test(name))
    .sort();
  return exports.length > 0 ? resolve(root, exports.at(-1)) : null;
}

function main() {
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
  const markdownPath = options.file
    ? resolve(root, options.file)
    : defaultMarkdownPath(root);

  if (!markdownPath) {
    console.error(`No file given and no conversation-export-*.md found in ${root}.\n\n${USAGE}`);
    process.exit(1);
  }

  if (!existsSync(markdownPath)) {
    console.error(`Markdown file not found: ${markdownPath}`);
    process.exit(1);
  }

  const source = readFileSync(markdownPath, "utf8");
  const blocks = [...source.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map(
    (match, index) => ({
      index: index + 1,
      line: source.slice(0, match.index).split("\n").length,
      body: match[1].replace(/\r\n/g, "\n").trim(),
    }),
  );

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

  const rel = (path) => relative(root, path);
  const version = run(["--yes", CLI, "--version"], root).output.split(/\r?\n/).pop() || "unknown";
  const results = [];

  for (const block of blocks) {
    const stem = join(outDir, `diagram-${String(block.index).padStart(2, "0")}`);
    const input = `${stem}.mmd`;
    const svg = `${stem}.svg`;
    const png = `${stem}.png`;
    writeFileSync(input, `${block.body}\n`);

    const render = (output, extra = []) =>
      run(
        ["--yes", CLI, "-i", rel(input), "-o", rel(output), ...extra, "-b", "white", "-p", rel(configPath)],
        root,
      );

    const svgResult = render(svg);
    const pngResult = options.png ? render(png, ["-e", "png", "--size", "1600"]) : { ok: true, output: "" };
    const info = existsSync(svg) ? dimensionsOf(svg) : { width: null, height: null, syntaxError: false };
    const failed =
      !svgResult.ok ||
      !existsSync(svg) ||
      info.syntaxError ||
      !pngResult.ok ||
      (options.png && !existsSync(png));

    results.push({
      ...block,
      ...info,
      svg: svgResult.ok,
      png: options.png ? pngResult.ok : null,
      failed,
      output: [svgResult.output, pngResult.output].filter(Boolean).join("\n"),
    });
  }

  console.log(`Mermaid CLI ${version}`);
  console.log(`Source: ${rel(markdownPath)}`);
  console.log(`Output: ${rel(outDir)}`);
  console.log(`Browser: ${browser ?? "bundled fallback"}`);
  console.log("");
  console.log("| # | line | SVG | PNG | viewBox | aspect |");
  console.log("|---|------|-----|-----|---------|--------|");

  for (const result of results) {
    const viewBox =
      result.width && result.height ? `${result.width}x${result.height}` : "unknown";
    const aspect =
      result.width && result.height ? (result.width / result.height).toFixed(2) : "unknown";
    const png = result.png === null ? "skipped" : result.png ? "ok" : "FAIL";
    console.log(
      `| ${result.index} | ${result.line} | ${result.svg ? "ok" : "FAIL"} | ${png} | ${viewBox} | ${aspect} |`,
    );
  }

  const failures = results.filter((result) => result.failed);
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${results.length} diagram(s) failed.`);
    for (const failure of failures) {
      console.error(`\n--- diagram ${failure.index} (line ${failure.line}) ---`);
      console.error(failure.output.split(/\r?\n/).slice(-20).join("\n") || "no renderer output");
    }
    process.exit(1);
  }

  console.log(`\nAll ${results.length} Mermaid diagrams rendered successfully.`);
  console.log("Inspect the PNGs for clipped labels, overlapping tags and extreme aspect ratios.");
}

main();
