# Export Conversation

Export the current conversation to a verified Markdown file, or store it in a project's `.export` directory for focused or multi-conversation archives.

Version 3.0.0. Requires Node.js 20 or newer. The runtime has no npm dependencies.

This repository is the maintained fork at [Alot1z/export-conversation-skill](https://github.com/Alot1z/export-conversation-skill).

## What it does

- Reads conversations from Claude Code, Codex, Gemini CLI, ChatGPT exports, OpenHands transcripts and generic JSON or JSONL.
- Stores immutable raw records, deterministic views and a hash-chained revision history under `<project>/.export/`.
- Reports source, selection and export coverage as independent dimensions.
- Verifies schema, raw integrity, view determinism, revisions, attachments, tool events, timestamps, redaction and render evidence.
- Renders Markdown, JSON and HTML, with optional Mermaid rendering and a review gallery.
- Exposes the same engine through a CLI and a dependency-free MCP stdio server.

## Install

### Claude Code plugin

```bash
git clone https://github.com/Alot1z/export-conversation-skill.git
cd export-conversation-skill
./install.sh
```

For a local test without installing:

```bash
claude --plugin-dir .
```

The plugin command is `/export-conversation:export`.

### Direct skill or CLI use

The runtime is the tree under `skills/export/` plus the shared `core/`, `adapters/`, `schemas/`, `catalogue/` and `scripts/` directories. Run commands from the repository root, or install the runtime into an agent root with:

```bash
node skills/export/scripts/install-skill.mjs
node skills/export/scripts/install-skill.mjs --check
```

## CLI

```bash
node scripts/conversation.mjs doctor
node scripts/conversation.mjs adapters
node scripts/conversation.mjs discover --root ~/.claude
node scripts/conversation.mjs detect --input session.db
node scripts/conversation.mjs import --adapter claude-code --input session.jsonl --project /path/to/project
node scripts/conversation.mjs list --project /path/to/project
node scripts/conversation.mjs get --id <id> --project /path/to/project
node scripts/conversation.mjs search --text "needle" --project /path/to/project
node scripts/conversation.mjs verify --all --project /path/to/project
node scripts/conversation.mjs export --id <id> --format md --project /path/to/project
node scripts/conversation.mjs index --project /path/to/project
node scripts/conversation.mjs migrate --all --project /path/to/project
node scripts/conversation.mjs recover --project /path/to/project
```

`detect --input` is read-only. A `sqlcipher-candidate` result is a conservative heuristic for a likely encrypted SQLite file. The tool does not decrypt databases or pass candidates to the plaintext SQLite reader.

## Storage layout

```text
<project>/.export/
├── project.json
├── index.md
├── README.md
├── overview.md
└── conversations/
    └── <conversation-id>/
        ├── raw/records.jsonl
        ├── view/conversation.json
        ├── capture/ledger.json
        ├── revisions/<n>.json
        ├── metadata.json
        ├── manifest.json
        └── export.md | export.json | export.html
```

Writes are staged, backed up, journaled and renamed. An interrupted write is reported and can be rolled back with `conversation recover`. A live lock blocks concurrent writers; a stale lock is ignored.

A focused export creates only the conversation directory. `project.json`, `index.md` and `README.md` are created only when an archive is deliberately initialized.

## Coverage

Coverage is not one boolean. The engine reports three independent dimensions:

- `coverage_source`: what portion of the source was available.
- `coverage_selection`: what portion of the available source was selected.
- `coverage_export`: what portion of the selection was rendered.

`COMPLETE` is only valid relative to the recorded source boundary. Unparseable or unknown records are preserved as `UNKNOWN` evidence instead of being dropped.

## Adapters

| Adapter | Kind | Evidence |
| --- | --- | --- |
| `claude-code` | native | live JSONL structure observed |
| `codex` | native | fixture-verified |
| `gemini-cli` | native | official session JSONL format |
| `chatgpt-export` | official export | synthetic ZIP tree fixture |
| `openhands-transcript` | official export | fixture-verified Markdown and HTML |
| `freebuff-thread-context` | native context | context payload only |
| `generic-json` | generic import | implemented and tested |
| `generic-jsonl` | generic import | implemented and tested |

Adapters never install a harness, bypass authentication or read a private store without an explicit readable path. A context payload is never labelled complete history.

## Project exports

```bash
# Resolve a destination without writing
node skills/export/scripts/project-export.mjs resolve --destination /path/to/project

# Focused export: only this conversation
node skills/export/scripts/project-export.mjs add \
  --source focused-export.md \
  --destination /path/to/project \
  --conversation-id conv-redaction-bug \
  --title "Redaction bug"

# Deliberate archive for multiple conversations
node skills/export/scripts/project-export.mjs add \
  --source verified.md \
  --destination /path/to/project \
  --archive \
  --conversation-id conv-architecture \
  --title "Architecture"

# Continue one conversation without touching the others
node skills/export/scripts/project-export.mjs add \
  --source updated.md \
  --destination /path/to/project \
  --update \
  --conversation-id conv-architecture

# Inspect and verify
node skills/export/scripts/project-export.mjs list --destination /path/to/project
node skills/export/scripts/project-export.mjs verify --destination /path/to/project
```

`filter` selects message ranges into an explicitly partial export. `overview` generates a project summary without modifying source exports. See [docs/PROJECT-EXPORTS.md](docs/PROJECT-EXPORTS.md).

## Verification and safety

Every export passes these gates:

- `scripts/redact.mjs` scans for private keys, provider tokens, credential assignments, bearer tokens and credential URLs. Check mode reports line and type only, never the value. `--write` replaces matches with `[REDACTED]`.
- `scripts/render-mermaid.mjs` extracts every Mermaid block, lints labels and diagram types, renders SVG and PNG, measures the canvas, flags extreme aspect ratios and missing text, and writes a JSON manifest. `--gallery` builds an HTML review page.
- `scripts/validate-export.mjs` checks front matter, required sections, message markers, coverage, secrets and the render manifest.
- `scripts/merge-export.mjs` merges a fresh export into an existing document without duplicating messages and preserves `<!-- export:manual:... -->` blocks.
- `conversation verify` checks the stored conversation dimensions and the project boundary, transactions and lock state.

The core does not send conversation data over the network. Exports are written to the local filesystem.

## MCP server

```bash
node scripts/mcp-server.mjs --self-test
```

The server speaks MCP over stdio and exposes 11 tools for capture, query, verification and export.

## Development

```bash
npm test
RUN_MERMAID=1 node --test tests/render-mermaid.test.mjs
node skills/export/scripts/validate-release.mjs
node skills/export/scripts/install-skill.mjs --check
node tools/build-package.mjs --clean --out ../.account-package
node tools/bench.mjs --profile=smoke
node scripts/conversation.mjs doctor
```

`npm test` lists every test file explicitly so the same command works on Node 20 and in every CI shell. It does not rely on test-runner glob expansion.

CI runs the suite on Ubuntu, Windows and macOS with Node 20, 22 and 24, builds and installs the package, and runs the MCP self-test. A separate job runs the real Mermaid renderer.

## Repository layout

```text
core/                        Dependency-free canonical engine
adapters/                    Optional harness data sources
catalogue/harnesses.json     Offline harness catalogue
schemas/                     Canonical, adapter and package schemas
scripts/                     CLI, MCP server, renderer, redaction and validators
skills/export/               Skill instructions, runtime manifest and helper scripts
tools/                       Package builder, benchmark and CI utilities
tests/                       Unit, crash, adapter, CLI, MCP and policy tests
docs/                        Architecture, adapters, security, migration and release notes
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Commits must not contain `Co-Authored-By` trailers, `Generated with` attribution or emoji.

## License

MIT. See [LICENSE](LICENSE).
