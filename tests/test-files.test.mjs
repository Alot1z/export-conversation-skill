import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TEST_DIR = join(ROOT, "tests");
const TEST_PATTERN = /tests\/[A-Za-z0-9._-]+\.test\.mjs/g;
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function referenced(command) {
  return [...new Set(String(command).match(TEST_PATTERN) ?? [])].sort();
}

const all = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `tests/${name}`)
  .sort();

test("npm test lists every test file explicitly", () => {
  assert.deepEqual(referenced(packageJson.scripts.test), all);
  assert.doesNotMatch(packageJson.scripts.test, /[*?\[\]{}]/);
});

test("test:core covers every test except the Mermaid gate", () => {
  assert.deepEqual(
    referenced(packageJson.scripts["test:core"]),
    all.filter((file) => file !== "tests/render-mermaid.test.mjs"),
  );
});

test("test:render runs only the Mermaid gate", () => {
  assert.deepEqual(referenced(packageJson.scripts["test:render"]), ["tests/render-mermaid.test.mjs"]);
});

test("CI and release workflows run the same explicit files", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");

  assert.deepEqual(referenced(ci), all);
  assert.deepEqual(referenced(release), all);
  assert.doesNotMatch(ci, /node --test\s*(?:>|$)/m);
  assert.doesNotMatch(release, /node --test\s*$/m);
});
