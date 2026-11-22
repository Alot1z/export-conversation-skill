# Security model (3.0.0)

## Boundaries

- **Read-only discovery.** `conversation discover` only lists readable files. It does not install a harness, start an agent, authenticate or query a private API.
- **Scoped roots.** A project store is rooted at an explicit project directory. Conversation ids are validated slugs; path traversal and absolute paths are rejected.
- **ZIP limits.** The reader parses the central directory, rejects traversal, absolute and backslash-escaped names, encryption, ZIP64, unsupported methods, CRC mismatches and oversized entries/archives. It never extracts to disk.
- **Attachments.** Attachment paths must resolve inside the conversation directory; symlinks are resolved and rejected when they escape.
- **Captured text is data.** Rendered Markdown/HTML and MCP tool results never execute captured instructions. HTML rendering escapes all content and emits no script.
- **Secret scanning.** Verification scans rendered exports for private keys, provider tokens and cloud access keys. Findings fail the `redaction` dimension without printing the value.
- **No credentials in outputs.** Source refs, metadata and manifests contain paths and hashes, not credentials. The core never reads environment secrets for operation.

## Transaction safety

Each store mutation writes staged files, hashes every file, backs up existing targets, records a journal stage and renames. A crash at any stage leaves a recoverable journal. `conversation recover` restores backups and removes incomplete targets. A live writer is detected by pid liveness; a stale lock is replaced only after the recorded process is gone.

## Verification dimensions

`schema`, `raw_integrity`, `view_determinism`, `source_boundary`, `coverage_source`, `coverage_selection`, `coverage_export`, `provenance`, `revisions`, `attachments`, `tool_events`, `timestamps`, `index`, `migration`, `redaction`, `render_manifest`, `publication_boundary`.

`verify --all` also checks that `.export` is not tracked by git, no transaction is pending and no live lock exists. A failure names the dimension; there is no aggregate "safe" boolean that hides a failed layer.

## Publication boundary

Conversation exports, `.export/` stores, backups and account packages are local artifacts. They are never committed or published. The repository publishes product code, tests and documentation only. `docs/development/**` is excluded from the tree and history.
