# Migrating 2.2.x exports to 3.0.0

Schema-1 exports stored by 2.2.x have `metadata.json`, `export.md` and a free-text `coverage` string. 3.0.0 stores immutable raw records, a deterministic view, a revision chain and dimensioned coverage.

## Run

```bash
node scripts/conversation.mjs migrate --all --project <project>
# or one conversation
node scripts/conversation.mjs migrate --id <conversation-id> --project <project>
```

## What migration does

1. Copies the whole conversation directory to `.export/backups/<id>-pre-migration-<timestamp>/` and writes a per-file hash manifest.
2. Parses `<!-- export:message:N -->` markers and heading roles from the legacy Markdown.
3. Stores every message with provenance `RECONSTRUCTED`; legacy messages are not raw upstream events.
4. Preserves the legacy `export.md` under `legacy/`, the original coverage claim, scope, tags and project identity in metadata.
5. Sets `source` coverage to `UNKNOWN` and `history_complete: false`; selection and export completeness are computed independently.
6. Writes schema 2 metadata, raw/view/ledger, revision 1 and Markdown/JSON/HTML renderings.
7. Records `migration.from_version`, timestamp, legacy path, backup path and original generator.

Migration is idempotent: a schema-2 export returns `skipped: true`.

## Rollback

```bash
node -e "import('./core/migrate.mjs').then(m => m.rollbackMigration('<project>', '<conversation-id>'))"
```

Rollback verifies the backup manifest, removes the migrated directory and restores the schema-1 copy. Re-running migration produces the same record hashes because identity does not depend on capture time.

## Limits

- A legacy export without message markers cannot be migrated automatically; it is reported as an error.
- Legacy text has no timestamps or raw tool events. Those fields stay unknown rather than being invented.
- The free-text coverage claim is preserved as evidence; it is never promoted to a verified `COMPLETE` status.
