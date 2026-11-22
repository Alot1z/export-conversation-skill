# Project-scoped conversation exports

The fork supports two related modes:

- **A single export file** in a path the user chooses, with the original workflow.
- **A project export** stored under `<project>/.export/`, optionally with a multi-conversation archive.

A generated conversation export is never written directly into the project root.

## 1. What `.export` is

`.export` is the project-local storage boundary for conversation exports. It belongs to the project, travels with it, and keeps generated conversation history separate from source code and ordinary documents.

```
<project>/.export/
├── project.json                  # archive identity (archive mode only)
├── index.md                      # generated index (archive mode only)
├── README.md                     # archive guidance (archive mode only)
├── overview.md                   # optional generated overview
├── conversations/
│   └── <conversation-id>/
│       ├── export.md             # readable conversation
│       ├── metadata.json         # authoritative identity, scope, revision, hash
│       └── manifest.json         # Mermaid render evidence when diagrams exist
└── assets/                       # only assets referenced by an export
```

`metadata.json` is authoritative for the conversation ID, project ID, coverage, scope, revision, byte count and export hash. `project.json` is authoritative for the project identity and name. `index.md` is generated from metadata; do not edit it by hand.

## 2. Why exports live there

- The project owns the conversation evidence that explains its decisions.
- Project roots stay clean.
- Multiple conversations can live side by side without filename collisions.
- Metadata and hashes make retrieval and integrity checks possible.
- A focused export does not force a project-wide archive.

## 3. Destination selection

Priority:

1. `--destination <path>` supplied by the user.
2. `--project <path>` established by task context.
3. The actual project root detected from the working directory.
4. If no reliable root can be identified, ask for a destination.

The process working directory is not automatically the project root. The open chat's project path is not automatically the destination. The skill repository, the home directory and a temporary directory are not defaults.

```bash
node skills/export/scripts/project-export.mjs resolve --destination "E:\Projects\Anvil"
node skills/export/scripts/project-export.mjs resolve --cwd "E:\Projects\Anvil\src"
```

`resolve` reports the project root, the `.export` path and how the root was found (`explicit-destination`, `explicit-project`, `git-root`, `project-marker`). It refuses to guess.

## 4. Project-root detection

The resolver first uses the Git root. If Git is unavailable or the directory is not a repository, it walks up to the nearest project marker:

- `.git`
- `package.json`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- `pom.xml`
- `build.gradle`
- `.export`

It does not select an arbitrary parent merely because a `.git` directory exists somewhere below it. If several plausible roots remain, pass `--destination` or ask one concise question.

## 5. Focused export

Use focused mode for a one-off subject or project selection.

```bash
node skills/export/scripts/project-export.mjs add \
  --source focused-export.md \
  --destination "E:\Projects\Anvil" \
  --conversation-id "conv-redaction-bug" \
  --title "Redaction bug discussion" \
  --scope "redaction bug only" \
  --filter "agent-selected messages" \
  --include "messages 12-18 of 80" \
  --exclude "unrelated projects and release work" \
  --coverage "partial (messages 12-18 selected from 80)"
```

This creates `.export/conversations/conv-redaction-bug/` and nothing else. It does **not** create `project.json`, `index.md` or `README.md`. If the archive already exists, the conversation is registered in it.

Filtering is done in two stages:

1. The agent reviews the conversation and chooses relevant messages. Use `filter` to enforce the selection and rewrite sequential markers.
2. `add` records the scope, included messages, exclusions, coverage and hash in `metadata.json`.

```bash
node skills/export/scripts/project-export.mjs filter \
  --source full-export.md \
  --messages 12-18 \
  --out focused-export.md \
  --project "Anvil" \
  --coverage "partial (messages 12-18 selected from 80; unrelated work excluded)"
```

The source document is not modified. The filtered export is explicitly partial; never label it a complete conversation export.

## 6. Project archive

Archive mode is deliberate. Initialize it when the project should accumulate multiple conversations:

```bash
node skills/export/scripts/project-export.mjs init --destination "E:\Projects\Anvil"
```

Or add the first conversation with `--archive`:

```bash
node skills/export/scripts/project-export.mjs add \
  --source verified.md \
  --destination "E:\Projects\Anvil" \
  --archive \
  --conversation-id "conv-architecture" \
  --title "Architecture discussion"
```

Each conversation gets its own directory. Two conversations about Anvil remain separate even when they share a project ID.

## 7. Update and merge

Continue one conversation without touching the others:

```bash
node skills/export/scripts/project-export.mjs add \
  --source updated.md \
  --destination "E:\Projects\Anvil" \
  --update \
  --conversation-id "conv-architecture"
```

`--update` uses the existing merge semantics:

- generated sections come from the new export;
- messages already present are kept once;
- higher-numbered messages are appended;
- `<!-- export:manual:... -->` blocks keep their old content;
- existing title, tags, coverage, mode and scope are preserved unless the corresponding flag is supplied;
- the revision increments;
- the export hash and byte count are recomputed.

It refuses a missing conversation. It refuses to overwrite an existing conversation without `--update`.

## 8. Inspect the index

```bash
node skills/export/scripts/project-export.mjs list --destination "E:\Projects\Anvil"
node skills/export/scripts/project-export.mjs list --destination "E:\Projects\Anvil" --json
```

`index.md` contains one row per conversation: subject, created, updated, coverage, revision and status. It is sorted deterministically by creation time and conversation ID. The index does not duplicate conversation contents.

## 9. Retrieve an export

```bash
node skills/export/scripts/project-export.mjs get \
  --destination "E:\Projects\Anvil" \
  --conversation-id "conv-architecture"
```

This prints the absolute `export.md` path. `--json` returns the metadata as well. Read `metadata.json` when you need the authoritative scope, coverage, revision or hash.

## 10. Legacy exports

Existing 2.2.0/2.2.1 Markdown exports keep their original front matter and markers. To place one in a project:

1. Validate it with `validate-export.mjs`; if it lacks markers, re-export with the current template before merging.
2. Add it with `project-export.mjs add` and an explicit `--conversation-id` if its `export_id` is not stable.
3. Record `coverage` exactly as the legacy document states. Do not fabricate markers or claim full coverage.

A legacy file written directly in a project root is not moved automatically. Copy it into `.export/conversations/<id>/export.md` only after validation, then update the project index with `add` or a deliberate archive import.

## 11. Avoiding unrelated material

Before writing:

- classify messages as directly relevant, supporting context, cross-project dependency, unrelated or uncertain;
- include supporting context only when it materially explains a decision;
- label cross-project dependencies;
- exclude unrelated projects and general conversation;
- record uncertain material as a coverage limitation.

The CLI cannot infer relevance reliably; the agent must make and record the selection. `filter` enforces the selected message set and the metadata makes the scope auditable.

## 12. Freebuff invocation

The registered Freebuff account skill `export-conversation` contains the same instructions and runtime scripts. Invoke it with `/export-conversation` or a natural-language request:

```
Export this conversation to E:\Projects\Anvil.
Export only the export-conversation-skill-fork discussion into this project's .export directory.
This is another conversation about Anvil. Save it in the existing archive.
```

The account skill runs `project-export.mjs` from its installed `scripts/` directory. If the account skill is unavailable, run the repository script directly:

```bash
node skills/export/scripts/project-export.mjs add --help
```

## Command summary

| Command | Purpose |
|---|---|
| `resolve` | Show the resolved project root and `.export` path |
| `init` | Create an archive (`project.json`, `index.md`, `README.md`) |
| `add` | Store a verified export; `--archive` initializes, `--update` merges |
| `filter` | Select message ranges into a focused, explicitly partial export |
| `list` | Read the project conversations without changing them |
| `get` | Locate one conversation export |
| `archive` | Mark a conversation archived without deleting content |
| `overview` | Generate an overview inside `.export/` from metadata |
| `verify` | Check schema, hashes, byte counts, project counts and index |

## Safety rules

- `.export` must resolve inside the destination; symlink escapes are refused.
- Conversation IDs reject path separators and `..`.
- Existing files are preserved.
- An existing conversation is never overwritten without `--update`.
- `--archive` is the only command that initializes archive infrastructure.
- `verify` is a metadata/integrity gate; it does not replace redaction, rendering or document validation.
