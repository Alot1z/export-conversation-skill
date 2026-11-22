/**
 * Dimensioned verification. `ok` is an aggregate; each dimension keeps its own
 * evidence so a failure names the layer that broke.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  PROVENANCE,
  buildView,
  hashObject,
  makeRecord,
  sha256,
  validateConversation,
  viewHash,
} from "./canonical.mjs";
import { applyCoverage, computeCoverage } from "./coverage.mjs";
import { listConversations, readConversation, resolveProject } from "./store.mjs";
import { pairToolEvents } from "./reconstruct.mjs";

export const VERIFY_DIMENSIONS = Object.freeze([
  "schema",
  "raw_integrity",
  "view_determinism",
  "source_boundary",
  "coverage_source",
  "coverage_selection",
  "coverage_export",
  "provenance",
  "revisions",
  "attachments",
  "tool_events",
  "timestamps",
  "index",
  "migration",
  "redaction",
  "render_manifest",
  "publication_boundary",
]);

const SECRET_PATTERNS = [
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

function readText(target) {
  if (!fs.existsSync(target)) throw new Error(`missing file: ${path.basename(target)}`);
  return fs.readFileSync(target, "utf8");
}

function dimension(name, fn) {
  try {
    const evidence = fn();
    return { name, status: "PASS", evidence };
  } catch (error) {
    return { name, status: "FAIL", error: error.message };
  }
}

function skip(name, reason) {
  return { name, status: "SKIP", reason };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkRevisions(dir, metadata) {
  const revisionsDir = path.join(dir, "revisions");
  assert(fs.existsSync(revisionsDir), "revisions directory is missing");
  const files = fs
    .readdirSync(revisionsDir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  assert(files.length > 0, "no revisions recorded");
  let previousText = null;
  const chain = [];
  for (let index = 0; index < files.length; index += 1) {
    const expected = index + 1;
    assert(Number.parseInt(files[index], 10) === expected, `revision gap at ${files[index]}`);
    const text = fs.readFileSync(path.join(revisionsDir, files[index]), "utf8");
    const record = JSON.parse(text);
    assert(record.revision === expected, `revision number mismatch in ${files[index]}`);
    if (expected === 1) {
      assert(record.previous_sha256 === null, "first revision must not have a predecessor");
    } else {
      assert(
        record.previous_sha256 === sha256(previousText),
        `revision ${expected} does not chain to its predecessor`,
      );
    }
    chain.push(sha256(text));
    previousText = text;
  }
  assert(
    chain.at(-1) === metadata.export?.chain_sha256,
    "latest revision hash does not match metadata",
  );
  return { revisions: files.length, chain_sha256: chain.at(-1) };
}

function checkAttachments(dir, attachments) {
  let verified = 0;
  let unavailable = 0;
  for (const attachment of attachments) {
    if (attachment.status !== "present") {
      unavailable += 1;
      continue;
    }
    if (!attachment.path) {
      if (!attachment.sha256) throw new Error(`attachment ${attachment.name} has no path or hash`);
      continue;
    }
    const target = path.resolve(dir, attachment.path);
    assert(inside(fs.realpathSync(dir), target), `attachment escapes the conversation: ${attachment.name}`);
    assert(fs.existsSync(target), `attachment file is missing: ${attachment.name}`);
    assert(
      inside(fs.realpathSync(dir), fs.realpathSync(target)),
      `attachment symlink escapes the conversation: ${attachment.name}`,
    );
    const actual = sha256(fs.readFileSync(target));
    assert(actual === attachment.sha256, `attachment hash mismatch: ${attachment.name}`);
    verified += 1;
  }
  return { verified, unavailable };
}

export function verifyConversation(projectRoot, conversationId) {
  const resolved = resolveProject(projectRoot);
  const conversation = readConversation(projectRoot, conversationId);
  const { dir, metadata, view, raw } = conversation;
  const dimensions = [];

  dimensions.push(
    dimension("schema", () => {
      const result = validateConversation(view);
      assert(result.ok, result.errors.join("; "));
      assert(metadata.schema_version === 2, "metadata schema is not 2");
      return { records: view.records.length, branches: view.branches.length };
    }),
  );

  dimensions.push(
    dimension("raw_integrity", () => {
      const rawText = readText(path.join(dir, "raw", "records.jsonl"));
      assert(sha256(rawText) === metadata.export.raw_sha256, "raw file hash mismatch");
      assert(raw.length === metadata.export.record_count, "raw record count mismatch");
      for (const record of raw) {
        const rebuilt = makeRecord(record);
        assert(rebuilt.hash === record.hash, `record hash mismatch: ${record.id}`);
        if (record.raw !== null) {
          assert(hashObject(record.raw) === record.rawHash, `raw payload hash mismatch: ${record.id}`);
        }
      }
      return { bytes: Buffer.byteLength(rawText), records: raw.length };
    }),
  );

  dimensions.push(
    dimension("view_determinism", () => {
      const viewText = readText(path.join(dir, "view", "conversation.json"));
      assert(sha256(viewText) === metadata.export.view_sha256, "view file hash mismatch");
      const rebuilt = buildView({
        conversation: view.conversation,
        source: view.source,
        boundary: view.boundary,
        records: raw,
        events: view.events,
        attachments: view.attachments,
        warnings: view.warnings,
        activeBranch: view.conversation.active_branch,
      });
      applyCoverage(rebuilt, { boundary: view.boundary });
      assert(viewHash(rebuilt) === viewHash(view), "rebuilding from raw does not reproduce the view");
      return { view_sha256: viewHash(view) };
    }),
  );

  dimensions.push(
    dimension("source_boundary", () => {
      assert(hashObject(metadata.boundary) === hashObject(view.boundary), "boundary mismatch");
      assert(
        hashObject(metadata.coverage) === hashObject(view.coverage),
        "metadata coverage differs from the stored view",
      );
      const recomputed = computeCoverage({ records: view.records, boundary: view.boundary });
      assert(
        recomputed.source.status === view.coverage.source.status,
        "source coverage status does not match the boundary",
      );
      if (view.coverage.source.status === "COMPLETE") {
        assert(view.boundary.history_complete === true, "COMPLETE source requires complete history");
        assert(view.boundary.records_unavailable === 0, "COMPLETE source cannot have unavailable records");
      }
      return {
        kind: view.boundary.kind,
        history_complete: view.boundary.history_complete,
        available: view.boundary.records_available,
        captured: view.boundary.records_captured,
      };
    }),
  );

  for (const dimensionName of ["source", "selection", "export"]) {
    dimensions.push(
      dimension(`coverage_${dimensionName}`, () => {
        const recomputed = computeCoverage({ records: view.records, boundary: view.boundary });
        assert(
          recomputed[dimensionName].status === view.coverage[dimensionName].status,
          `coverage.${dimensionName}.status is inconsistent`,
        );
        assert(
          metadata.coverage?.[dimensionName]?.status === recomputed[dimensionName].status,
          `metadata coverage.${dimensionName}.status is inconsistent`,
        );
        return {
          status: view.coverage[dimensionName].status,
          reason: view.coverage[dimensionName].reason,
        };
      }),
    );
  }

  dimensions.push(
    dimension("provenance", () => {
      const counts = {};
      for (const record of view.records) {
        assert(PROVENANCE.includes(record.provenance), `invalid provenance: ${record.id}`);
        counts[record.provenance] = (counts[record.provenance] ?? 0) + 1;
      }
      assert(
        hashObject(counts) ===
          hashObject(
            Object.fromEntries(
              Object.entries(view.coverage.counts)
                .filter(([key]) => key !== "total" && key !== "unavailable" && key !== "unverified")
                .filter(([key]) => (counts[key.toUpperCase()] ?? 0) > 0)
                .map(([key]) => [key.toUpperCase(), counts[key.toUpperCase()]]),
            ),
          ) || view.records.length === 0,
        "provenance counts disagree with the records",
      );
      return { counts };
    }),
  );

  dimensions.push(
    dimension("revisions", () => checkRevisions(dir, metadata)),
  );

  dimensions.push(
    dimension("attachments", () => checkAttachments(dir, view.attachments)),
  );

  dimensions.push(
    dimension("tool_events", () => {
      const recomputed = pairToolEvents(view.records);
      assert(
        hashObject(recomputed) === hashObject(view.tool_pairs),
        "tool pairs do not match the records",
      );
      const missing = recomputed.filter((pair) => pair.status !== "complete");
      return { pairs: recomputed.length, incomplete: missing.length };
    }),
  );

  dimensions.push(
    dimension("timestamps", () => {
      const created = Date.parse(metadata.conversation?.created_at ?? "");
      const updated = Date.parse(metadata.conversation?.updated_at ?? "");
      assert(Number.isFinite(created), "created_at is not a timestamp");
      assert(Number.isFinite(updated), "updated_at is not a timestamp");
      assert(created <= updated, "created_at is after updated_at");
      let parsed = 0;
      let last = -Infinity;
      let monotonic = true;
      for (const record of view.records) {
        if (!record.timestamp) continue;
        const value = Date.parse(record.timestamp);
        if (!Number.isFinite(value)) throw new Error(`invalid timestamp on ${record.id}`);
        parsed += 1;
        if (value < last) monotonic = false;
        last = value;
      }
      return { parsed, monotonic };
    }),
  );

  dimensions.push(
    dimension("index", () => {
      const indexPath = path.join(resolved.exportRoot, "index.md");
      if (!fs.existsSync(indexPath)) return { present: false };
      const index = fs.readFileSync(indexPath, "utf8");
      assert(index.includes(conversationId), "index does not list this conversation");
      return { present: true };
    }),
  );

  dimensions.push(
    dimension("migration", () => {
      if (!metadata.migration) return { migrated: false };
      assert(metadata.migration.from_version, "migration source version is missing");
      assert(metadata.migration.at, "migration timestamp is missing");
      if (metadata.migration.legacy_path) {
        assert(
          fs.existsSync(path.join(dir, metadata.migration.legacy_path)),
          "legacy source copy is missing",
        );
      }
      return { migrated: true, from: metadata.migration.from_version };
    }),
  );

  dimensions.push(
    dimension("redaction", () => {
      const found = [];
      for (const name of Object.keys(metadata.export?.exports ?? {})) {
        const target = path.join(dir, name);
        if (!fs.existsSync(target)) continue;
        const text = fs.readFileSync(target, "utf8");
        for (const rule of SECRET_PATTERNS) {
          if (rule.pattern.test(text)) found.push({ file: name, rule: rule.name });
        }
      }
      assert(found.length === 0, `secret-like content found: ${JSON.stringify(found)}`);
      return { scanned: Object.keys(metadata.export?.exports ?? {}).length };
    }),
  );

  dimensions.push(
    dimension("render_manifest", () => {
      const exports = metadata.export?.exports ?? {};
      for (const [name, hash] of Object.entries(exports)) {
        const target = path.join(dir, name);
        assert(fs.existsSync(target), `rendered export is missing: ${name}`);
        assert(sha256(fs.readFileSync(target)) === hash, `rendered export hash mismatch: ${name}`);
      }
      return { files: Object.keys(exports).length };
    }),
  );

  dimensions.push(
    dimension("publication_boundary", () => {
      const realDir = fs.realpathSync(dir);
      assert(
        inside(fs.realpathSync(resolved.exportRoot), realDir),
        "conversation directory escapes the export root",
      );
      const stat = fs.lstatSync(dir);
      assert(stat.isDirectory(), "conversation path is not a directory");
      return { path: path.relative(resolved.root, realDir) };
    }),
  );

  const ok = dimensions.every((entry) => entry.status !== "FAIL");
  return {
    id: conversationId,
    ok,
    dimensions,
    failed: dimensions.filter((entry) => entry.status === "FAIL").map((entry) => entry.name),
  };
}

function projectDimensions(projectRoot) {
  const resolved = resolveProject(projectRoot);
  const dimensions = [];

  dimensions.push(
    dimension("git_boundary", () => {
      if (!fs.existsSync(path.join(resolved.root, ".git"))) return { git: false };
      let tracked = "";
      try {
        tracked = execFileSync("git", ["-C", resolved.root, "ls-files", "--", ".export"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch (error) {
        throw new Error(`cannot inspect git tracking: ${error.message}`);
      }
      assert(tracked === "", `conversation exports are tracked by git: ${tracked.split("\n")[0]}`);
      return { git: true, tracked: 0 };
    }),
  );

  dimensions.push(
    dimension("transactions", () => {
      const transactionsRoot = path.join(resolved.exportRoot, "transactions");
      if (!fs.existsSync(transactionsRoot)) return { transactions: 0 };
      const pending = fs.readdirSync(transactionsRoot);
      assert(pending.length === 0, `unrecovered transactions: ${pending.join(", ")}`);
      return { transactions: 0 };
    }),
  );

  dimensions.push(
    dimension("lock", () => {
      const lockPath = path.join(resolved.exportRoot, "lock.json");
      if (!fs.existsSync(lockPath)) return { locked: false };
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      try {
        process.kill(lock.pid, 0);
      } catch {
        return { locked: false, stale_pid: lock.pid };
      }
      throw new Error(`store is locked by a live process: ${lock.pid}`);
    }),
  );

  return dimensions;
}

export function verifyAll(projectRoot) {
  const conversations = listConversations(projectRoot).filter((entry) => entry.status === "ok");
  const results = conversations.map((entry) => verifyConversation(projectRoot, entry.id));
  const project = projectDimensions(projectRoot);
  const ok =
    results.every((result) => result.ok) && project.every((entry) => entry.status !== "FAIL");
  return { ok, conversations: results, project };
}
