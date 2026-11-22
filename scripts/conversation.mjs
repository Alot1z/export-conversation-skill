#!/usr/bin/env node
/** Export Conversation 3.0.0 command line. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../adapters/index.mjs";
import { listAdapters } from "../core/registry.mjs";
import { listConversations, readConversation, resolveProject } from "../core/store.mjs";
import { coverageSummary } from "../core/coverage.mjs";
import { VERIFY_DIMENSIONS } from "../core/verify.mjs";
import {
  doctorChecks,
  discoverSources,
  importConversation,
  migrate,
  readCatalogue,
  recoverStore,
  renderExport,
  search,
  verify,
  writeIndex,
} from "../core/service.mjs";

const VERSION = "3.0.0";

export function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const key = arg.slice(2);
    if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      options[key] = argv[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function project(options) {
  return options.project ?? process.cwd();
}

function print(value) {
  if (typeof value === "string") process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function summary(conversation) {
  const coverage = conversation.coverage ?? {};
  return [
    conversation.id,
    conversation.title,
    `r${conversation.revision}`,
    conversation.source?.adapter ?? "unknown",
    coverageSummary(coverage),
    `${conversation.counts?.total ?? 0} records`,
  ].join(" | ");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const command = options._[0] ?? "help";
  try {
    switch (command) {
      case "version":
        print({ name: "export-conversation", version: VERSION, schema: 2, node: process.version });
        return 0;
      case "doctor": {
        const result = await doctorChecks();
        if (options.json) print(result);
        else {
          for (const check of result.checks) {
            print(`${check.status.padEnd(4)} ${check.name}${check.error ? ` — ${check.error}` : ` — ${JSON.stringify(check.detail)}`}`);
          }
        }
        return result.ok ? 0 : 1;
      }
      case "adapters":
        print(listAdapters());
        return 0;
      case "catalogue":
        print(readCatalogue());
        return 0;
      case "discover": {
        if (!options.root) throw new Error("--root is required");
        print(discoverSources(options.root));
        return 0;
      }
      case "import": {
        const result = await importConversation({
          project: project(options),
          adapter: options.adapter,
          input: options.input,
          id: options.id,
          title: options.title,
          sourceRef: options["source-ref"],
          complete: options.complete === true ? true : undefined,
          update: options.update === true,
          now: options.now,
        });
        print(result);
        return 0;
      }
      case "list":
      case "status": {
        const conversations = listConversations(project(options));
        if (options.json) print(conversations);
        else if (conversations.length === 0) print("No conversations.");
        else for (const conversation of conversations) print(summary(conversation));
        return conversations.some((entry) => entry.status !== "ok") ? 1 : 0;
      }
      case "get":
      case "inspect": {
        if (!options.id) throw new Error("--id is required");
        const conversation = readConversation(project(options), options.id);
        print({
          metadata: conversation.metadata,
          records: conversation.view?.records?.length ?? 0,
          coverage: conversation.metadata.coverage,
          warnings: conversation.view?.warnings ?? [],
        });
        return 0;
      }
      case "search": {
        if (!options.text) throw new Error("--text is required");
        print(
          search(project(options), {
            text: options.text,
            role: options.role,
            adapter: options.adapter,
            from: options.from,
            to: options.to,
            limit: options.limit ? Number(options.limit) : undefined,
          }),
        );
        return 0;
      }
      case "verify": {
        const result = verify(project(options), options.all ? null : options.id ?? null);
        if (options.json) print(result);
        else if (result.conversations) {
          for (const entry of result.conversations) {
            print(`${entry.ok ? "PASS" : "FAIL"} ${entry.id}${entry.failed?.length ? ` — ${entry.failed.join(", ")}` : ""}`);
          }
          for (const entry of result.project) {
            print(`${entry.status.padEnd(4)} project.${entry.name}${entry.error ? ` — ${entry.error}` : ""}`);
          }
          print(result.ok ? "verify: ok" : "verify: failed");
        } else {
          for (const entry of result.dimensions) {
            print(`${entry.status.padEnd(4)} ${entry.name}${entry.error ? ` — ${entry.error}` : ""}`);
          }
          print(result.ok ? "verify: ok" : `verify: failed (${result.failed.join(", ")})`);
        }
        return result.ok ? 0 : 1;
      }
      case "export": {
        if (!options.id) throw new Error("--id is required");
        const rendered = renderExport(project(options), options.id, options.format ?? "md");
        if (options.out) {
          fs.writeFileSync(path.resolve(options.out), rendered.content);
          print({ wrote: path.resolve(options.out), bytes: Buffer.byteLength(rendered.content), format: rendered.format });
        } else {
          process.stdout.write(rendered.content);
        }
        return 0;
      }
      case "index": {
        print(writeIndex(project(options), { now: options.now }));
        return 0;
      }
      case "migrate": {
        const result = migrate(project(options), { id: options.id, all: options.all === true, now: options.now });
        print(result);
        return result.migrated?.some((entry) => entry.migrated === false && entry.skipped === false) ? 1 : 0;
      }
      case "recover": {
        print(recoverStore(project(options)));
        return 0;
      }
      case "dimensions":
        print(VERIFY_DIMENSIONS);
        return 0;
      case "where": {
        const resolved = resolveProject(project(options));
        print({ project: resolved.root, export: resolved.exportRoot });
        return 0;
      }
      case "help":
      default:
        print(`export-conversation ${VERSION}

Usage:
  conversation <command> [options]

Commands:
  doctor                         Runtime, core, adapters, catalogue, ZIP and SQLite checks
  adapters                       List registered adapters
  catalogue                      Print the offline harness catalogue
  discover --root <dir>          Find readable harness sources without modifying them
  import --adapter <id> --input <file> [--project <dir>] [--id <id>] [--title <text>]
                                 Ingest one source into .export/conversations/<id>
  list [--project <dir>]         List conversations
  get --id <id>                  Metadata, coverage and warnings
  search --text <text>           Search records across conversations
  verify [--id <id> | --all]     Dimensioned verification
  export --id <id> [--format md|json|html] [--out <file>]
  index                          Regenerate .export/index.md
  migrate [--id <id> | --all]    Migrate schema-1 exports
  recover                        Roll back interrupted transactions
  dimensions                     List verification dimensions
  version | where | help`);
        return command === "help" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    if (process.env.DEBUG) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
