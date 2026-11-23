# Changelog

All notable changes to the export-conversation skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-11-22

### Added

- Dependency-free canonical conversation model (schema 2) with immutable hashed raw records, deterministic derived views, branches, tool pairing, attachments and provenance classes.
- Ingest engine with byte-based format detection, JSON, JSONL, Markdown and HTML readers, a full ZIP reader (central directory, stored and deflate entries, CRC-32, traversal, encryption, ZIP64 and size rejection) and read-only SQLite capability detection.
- Transactional `.export` store with staged hashes, per-file backups, a stage journal, crash recovery, liveness-checked locking and immutable revision chains.
- Three independent coverage dimensions (`source`, `selection`, `export`) plus an explicit source boundary. Free-text "complete" claims are no longer accepted as coverage.
- Dimensioned verification for schema, raw integrity, view determinism, source boundary, coverage, provenance, revisions, attachments, tool events, timestamps, index, migration, redaction, render manifest and publication boundary.
- Offline adapters for Claude Code, Codex, Gemini CLI, ChatGPT exports, OpenHands transcripts, Freebuff thread context and generic JSON or JSONL, with evidence classes and a catalogue.
- `scripts/conversation.mjs` CLI (doctor, adapters, catalogue, discover, detect, import, list, get, search, verify, export, index, migrate and recover) and a dependency-free MCP stdio server with 11 tools.
- Schema-1 migration with verified backups, rollback, idempotency and stable re-import identity.
- `tools/build-package.mjs` reproducible packages bound to a commit, `tools/bench.mjs`, canonical, adapter and package JSON schemas, and architecture, adapter, security and migration documentation.

### Changed

- The runtime package is a self-contained tree (`SKILL.md`, `core/`, `adapters/`, `scripts/`, `schemas/` and `catalogue/`) with source mappings. Installed roots receive the full core.
- The installer verifies a package manifest and its commit with `--package` and reports the complete runtime file set.
- Version surfaces, plugin metadata and release validation describe 3.0.0.
- The test suite lists every test file explicitly for Node 20 and CI compatibility.

## [2.2.1] - 2026-11-21

### Added

- Project-scoped exports under `<project>/.export/`, with focused and archive modes, stable project and conversation identities, revisions, deterministic project indexes and integrity verification.
- `scripts/project-export.mjs` with `resolve`, `init`, `add`, `filter`, `list`, `get`, `archive`, `overview` and `verify`.
- `schemas/project-export.schema.json` for machine-readable conversation metadata.
- `docs/PROJECT-EXPORTS.md` and project workflow steps in `SKILL.md`, `README.md` and `QUICKSTART.md`.

### Fixed

- Redaction scans every line, including lines that already contain a `[REDACTED]` placeholder. Multiple secrets on one line and private-key-plus-token lines are handled.
- Incremental merge preserves manual blocks that exist only in the old export instead of dropping them.
- `project-export.mjs add --update` preserves the existing title, tags, coverage, mode and scope unless the corresponding flag is supplied.

### Changed

- `skill-manifest.json` separates runtime entries from `devFiles`. Installed roots no longer receive `install-skill.mjs`, `run-evals.mjs` or `validate-release.mjs`.
- The installer detects stale development files, prunes only known manifest-owned files, supports `--no-prune`, and adds safe `--project <root>` installation under `.agents/skills`.
- Release validation understands `devFiles`, rejects runtime and development overlap, and reports unclassified scripts.
- The runtime `SKILL.md` no longer references development-only maintenance commands.

## [2.2.0] - 2026-11-21

### Added

- Secret redaction gate (`scripts/redact.mjs`) with check and write modes.
- Render manifest, HTML review gallery, diagram lint and layout warnings.
- Export validator for structure, coverage, secrets and render evidence.
- Incremental marker-based merge that preserves manual blocks.
- Multi-root installer with `--check` drift detection.
- Local image copying with alt-text filling (`scripts/assets.mjs`).
- Release consistency checks and a CI matrix.

### Changed

- The skill workflow runs redact, render, validate and merge as Steps 4a to 4d.
- The renderer supports `--offline`, `--mmdc`, `--timeout`, `--jobs`, `--strict-layout`, `--strict-lint` and `--max-diagrams`.

## [2.1.0] - 2026-11-21

### Added

- Step 4b: every Mermaid block must be rendered and inspected, not just counted.
- `skills/export/scripts/render-mermaid.mjs` renderer and validator (SVG and PNG, size table, non-zero exit on failure).
- `--out` and `--no-png` options.

### Changed

- The renderer builds one quoted shell command instead of passing an argument array with `shell: true`.
- The default input is the newest `conversation-export-*.md`; no project-specific path is assumed.
- The Puppeteer config always enables `--no-sandbox`, with a local browser when available.

### Fixed

- Paths containing spaces no longer break rendering.
- Removed the `DEP0190` warning from `shell: true` with an args array.

## [2.0.0] - 2026-04-08

### Added

- Mermaid diagram support with seven diagram types.
- Visual Overview section in exports.
- Architecture, sequence, flowchart, class, state, git and ER diagrams.
- Diagram quality standards and guidelines.
- Diagram inclusion based on conversation content.
- Conversation review checklist.
- Expanded export format and template structure.

## [1.0.0] - 2026-04-08

### Added

- Initial release.
- Conversation export to Markdown.
- Session statistics tracking.
- File change logging with action types.
- Automatic timestamp generation for filenames.
- Custom filename and path support.
- Sensitive data sanitization for API keys and passwords.
- Conversation summary generation.
- Tool usage tracking for Bash, Read, Write and Edit.
- Documentation in `SKILL.md`.
- Edge case handling for empty conversations and failed tools.
- Chronological message ordering.
- User and assistant message capture.
- Directory path support for output.
