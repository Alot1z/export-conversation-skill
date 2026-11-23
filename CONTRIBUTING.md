# Contributing

## Requirements

- Node.js 20 or newer.
- Git.
- No npm install is required for the runtime or the tests.

## Development setup

```bash
git clone https://github.com/Alot1z/export-conversation-skill.git
cd export-conversation-skill
node scripts/conversation.mjs doctor
```

To exercise the skill from a Claude Code checkout:

```bash
claude --plugin-dir .
```

To install it into an agent root:

```bash
node skills/export/scripts/install-skill.mjs
node skills/export/scripts/install-skill.mjs --check
```

## Tests

Run the full suite:

```bash
npm test
```

The `test` script lists every test file explicitly. Do not replace it with `node --test` or a glob: Node 20 and some CI shells do not expand test globs consistently.

Run the real Mermaid renderer separately:

```bash
RUN_MERMAID=1 node --test tests/render-mermaid.test.mjs
```

Before a release or package build, run:

```bash
node skills/export/scripts/validate-release.mjs
node skills/export/scripts/install-skill.mjs --check
node tools/build-package.mjs --clean --out ../.account-package
```

Add or update a test for every behavioral script change. A fence count is not validation; renderer and skill workflow changes must pass the renderer and release checks.

## Commit messages

Write the message in a file and commit it verbatim:

```bash
git commit -F path/to/message.txt
```

Do not use a harness or helper that appends attribution. Every commit must follow these rules:

- No `Co-Authored-By` trailer.
- No `Generated with Codebuff`, `Generated with Freebuff` or similar line.
- No tool, model or agent attribution in the subject or body.
- No emoji.
- A short imperative subject, then a factual body when the reason is not obvious.

The same rules apply to pull request titles, pull request bodies, issues and documentation. Keep public artifacts focused on the project, not on the tooling used to produce them.

Install the local commit-msg hook once per clone:

```bash
npm run hooks:install
```

CI runs `node tools/check-commit-policy.mjs` and fails on a violation.

## Pull requests

1. Create a branch from `main`.
2. Keep the change focused and include tests for behavior changes.
3. Run `npm test` and `node skills/export/scripts/validate-release.mjs`.
4. Open a pull request with a factual description of the problem and the change.
5. Do not include generated exports, local `.export` data, secrets or machine-specific paths.

## Code style

- Use ESM and the existing dependency-free style.
- Keep the core independent of harness SDKs, LLM clients, MCP clients and paid services.
- Preserve raw evidence; do not drop unknown records to make a test pass.
- Refuse unsafe paths and symlink escapes instead of writing through them.
- Report verification failures honestly. Do not weaken a test or a gate to make it pass.

## Security

Do not commit credentials, tokens, private conversation exports or absolute paths from a local machine. Report a security issue privately to the maintainer rather than opening a public issue with exploit details.
