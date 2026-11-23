# Quick Start

This guide installs the skill and runs a first verified export. It assumes Node.js 20 or newer.

## 1. Install

```bash
git clone https://github.com/Alot1z/export-conversation-skill.git
cd export-conversation-skill
./install.sh
```

For a local plugin test without installing:

```bash
claude --plugin-dir .
```

Check the runtime:

```bash
node scripts/conversation.mjs doctor
```

The doctor checks ZIP support, SQLite capability detection, the project resolver and the lock implementation. Every line must report `PASS`.

## 2. Import a conversation

```bash
node scripts/conversation.mjs import \
  --adapter claude-code \
  --input session.jsonl \
  --project /path/to/project
```

The import writes to `/path/to/project/.export/conversations/<id>/`. It does not write into the project root.

List and inspect conversations:

```bash
node scripts/conversation.mjs list --project /path/to/project
node scripts/conversation.mjs get --id <id> --project /path/to/project
```

## 3. Export

```bash
node scripts/conversation.mjs export \
  --id <id> \
  --format md \
  --project /path/to/project
```

Supported formats are `md`, `json` and `html`.

Verify the stored conversation and the project boundary:

```bash
node scripts/conversation.mjs verify --all --project /path/to/project
```

## 4. Work from Claude Code

Use the skill command:

```text
/export-conversation
/export-conversation --destination /path/to/project
/export-conversation --destination /path/to/project --archive
```

The skill reviews the available conversation, writes a Markdown document, runs redaction, Mermaid rendering and document validation, then registers the result under the project's `.export/` directory.

## 5. Check a finished export

```bash
node scripts/redact.mjs export.md
node scripts/render-mermaid.mjs export.md --gallery
node scripts/validate-export.mjs export.md
```

A clean redaction check exits 0 without printing secret values. The renderer writes a manifest beside the export and exits non-zero on a syntax or render failure. The validator checks structure, message numbering, coverage and the render manifest.

See [README.md](README.md) for adapters, storage details, MCP access and development commands.
