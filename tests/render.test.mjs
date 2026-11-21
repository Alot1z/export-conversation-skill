import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENABLED = process.env.RUN_MERMAID === "1";

test(
  "render-mermaid renders a fixture, writes a manifest and gallery",
  { skip: ENABLED ? false : "set RUN_MERMAID=1 to run the Mermaid CLI test" },
  () => {
    const out = mkdtempSync(join(tmpdir(), "export-render-"));
    const manifest = join(out, "render.manifest.json");
    const result = spawnSync(
      process.execPath,
      [
        join(ROOT, "skills/export/scripts/render-mermaid.mjs"),
        "tests/fixtures/render.md",
        "--out",
        out,
        "--no-png",
        "--gallery",
        "--manifest",
        manifest,
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 300000 },
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(report.ok, true);
    assert.equal(report.diagrams.length, 2);
    assert.ok(report.diagrams.every((diagram) => diagram.svg));
    assert.ok(existsSync(join(out, "index.html")));
  },
);
