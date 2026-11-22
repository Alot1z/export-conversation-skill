# Architecture (3.0.0)

Export Conversation 3.0.0 separates **conversation data** from **harness access**.

```text
source files / exports / context payloads
        │
        ▼
adapters/*.mjs          optional, contract-only data sources
        │  capture() -> canonical view input
        ▼
core/canonical.mjs      schema 2 records, hashes, branches, provenance
core/coverage.mjs       source / selection / export + boundary
        │
        ▼
core/store.mjs          transactions, backups, journal, lock, revisions
        │
        ├── raw/records.jsonl         immutable evidence
        ├── view/conversation.json    deterministic derived view
        ├── capture/ledger.json       provenance ledger
        ├── revisions/<n>.json        hash chain
        └── export.md|json|html       renderings
        │
        ├── core/query.mjs            search, compare, dedupe
        ├── core/verify.mjs           17 verification dimensions
        └── core/service.mjs          CLI and MCP operations
```

## Invariants

1. **Raw is immutable.** `raw/records.jsonl` is written once per revision and hashed in metadata. The view is derived from raw and can be rebuilt byte-for-byte.
2. **No silent loss.** Unknown records, unsupported message parts and malformed JSONL lines are preserved with source evidence and marked `UNKNOWN`.
3. **No silent completion.** Coverage is three dimensions plus a boundary. A context payload is never complete history.
4. **Transactions, not writes.** Every mutation has a journal with staged hashes and per-file backups. Recovery rolls back any stage that did not commit.
5. **Core independence.** `core/` imports only Node built-ins and other core modules. No harness SDK, LLM client, MCP SDK or npm runtime dependency.
6. **One engine, several surfaces.** CLI, MCP and library calls all go through `core/service.mjs` or the store; there is no second implementation.

## Storage layout

```text
<project>/.export/
├── index.md                         generated project index
├── lock.json                        liveness-checked writer lock
├── transactions/                    journals for in-flight writes
├── backups/                         pre-migration verified backups
└── conversations/<id>/
    ├── raw/records.jsonl
    ├── view/conversation.json
    ├── capture/ledger.json
    ├── revisions/<n>.json
    ├── metadata.json
    ├── manifest.json
    └── export.md|export.json|export.html
```

## Determinism

`buildView()` uses sequence, timestamp and id ordering, never a clock. Renderers accept an explicit `generatedAt`. Verification rebuilds the view from raw and compares the canonical hash. The same raw input and boundary therefore produce the same view bytes.

## Adapter boundary

An adapter implements:

```js
{
  id, version, harness, kind,
  capabilities: { user, assistant, system, toolCalls, toolResults,
                  attachments, timestamps, originalIds, pagination, fullHistory },
  async capture({ input, options }) -> canonical view,
  discover?({ root }) -> [{ path, ... }]
}
```

`core/registry.mjs` validates the contract. Adapters may use ingest helpers; core never imports an adapter.

## Extension points

Reserved interfaces, deliberately not implemented in 3.0.0:

- PDF renderer behind `core/render/*` and the CLI format registry.
- Full-text index behind `core/query.mjs`.
- OCR and multimodal attachment metadata in the attachment schema.
- Reconciliation identity across sources.
- Optional catalogue refresh; the shipped catalogue is offline.

No stub claims to work. A future implementation must add tests and evidence before changing a capability flag.

## Version split

- 3.0.0: independent core, storage, ingest, render, verify, adapters, CLI/MCP.
- 4.x: deeper ingestion (reconciliation, more harnesses).
- 5.x: intelligence (summaries, semantic search) as optional layers.
- 6.x: richer interfaces (PDF, GUI, integrations).
- 7.x: platform (multi-user, hosted sync).
