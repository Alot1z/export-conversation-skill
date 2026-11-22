# Release 3.0.0 evidence

## Baseline

- Node 26.5.0; 51/51 tests passing; `Release 2.2.1: valid`; 12/12 install roots with 9 files.
- The 2.2.1 engine was Markdown-centric; it had no canonical model, ingest engine, query, ZIP/SQLite/HTML readers, revisions or dimensioned verification.

## Delivered

- Schema 2 canonical model with immutable hashed raw records, deterministic views, branches, tool pairs, attachments and provenance classes.
- Full ZIP reader (central directory, stored/deflate, CRC-32, traversal/encryption/ZIP64/size rejection) and read-only SQLite capability detection.
- Transactional store with staged hashes, per-file backups, a stage journal, crash recovery, liveness-checked locking and hash-chained revisions.
- Three independent coverage dimensions plus a source boundary; free-text completeness claims are no longer trusted.
- Seventeen verification dimensions and project-level `git_boundary`, `transactions` and `lock` checks.
- Eight adapters, an offline catalogue, a CLI and an 11-tool MCP stdio server.
- Schema-1 migration with verified backups, rollback, idempotency and stable re-import identity.
- Reproducible package builder that refuses a dirty worktree, and an installer that verifies a package manifest and commit.

## Verification observed

| Check | Result |
| --- | --- |
| `node --test` | 127 pass, 0 fail, 1 skipped (Mermaid gate) |
| `RUN_MERMAID=1 node --test tests/render-mermaid.test.mjs` | 1 pass |
| `conversation doctor` | 7 PASS |
| `conversation verify --all` (workspace export) | pass, 17 conversation dimensions + 3 project dimensions |
| `conversation verify --all` (Anvil export) | pass, 17 conversation dimensions + 3 project dimensions |
| `node tools/bench.mjs --profile=smoke` | 8 conversations, 23 records, verify ok (import 8045 ms, search 33 ms, verify 70 ms) |
| Repaired exports | 14 and 12 `RECONSTRUCTED` records; `coverage_source=UNKNOWN`; backups recorded |
| Installed roots | 12/12, 44 files each, from package commit |
| Package reproducibility | local and fresh-clone packages: same 44 file hashes, 273,031 bytes |
| Cross-platform CI | Windows, Ubuntu and macOS × Node 20, 22 and 24: validate, clean package build, package install/check, full suite and MCP self-test |
| Fresh-clone audit | HEAD match; `docs/development` in 0 commits; 0 tracked `.export`; 0 machine-path matches; release valid; MCP self-test pass; full suite pass |
| Publication | force-with-lease from recorded `1f12973` to rewritten history; subsequent commits pushed normally |

## Status classification

- **IMPLEMENTED_AND_VERIFIED**: canonical model, store and recovery, coverage, verification, renderers, query, CLI, MCP, migration, generic JSON/JSONL, Claude Code, Gemini CLI, package and installs.
- **FIXTURE_VERIFIED**: Codex, ChatGPT export ZIP, OpenHands transcript.
- **LIVE_VERIFIED**: Claude Code JSONL structure was observed in a live installation; no new transcript was captured from it in this run. Gemini CLI is verified against its official recorded format.
- **PARTIALLY_IMPLEMENTED**: Freebuff thread context is a native context payload with an explicitly partial boundary; tool events are unavailable. The original Freebuff transcript still requires a thread mention.
- **NOT_IMPLEMENTED**: PDF rendering, full-text index, OCR/multimodal attachment content, cross-source reconciliation, catalogue network refresh. The interfaces are reserved and no stub claims to work.

## Boundaries

Conversation exports, backups and account packages are local and untracked. The published tree contains product code, tests and documentation only. The original 2.2.1 workspace notes were removed from both the tree and history; the historical bundle and tree archive remain in the local backup directory.
