# Upstream and fork policy

## Remotes

- `origin` - https://github.com/Alot1z/export-conversation-skill (the live fork)
- `upstream` - https://github.com/akoserwal/export-conversation-skill (original project)

## Divergence

The fork adds the verified export pipeline (2.2.x). Keep that work as small,
reviewable commits on `main` so it can be offered upstream as a pull request.

- Rebase new upstream releases onto `main`; do not merge unrelated history.
- Keep `skills/export/SKILL.md`, `scripts/`, tests and docs in the same commit
  as the behavior they describe.
- Never rewrite published tags.
- No push, tag, release or marketplace action without explicit approval.

## Sync with installed copies

After changing the skill, run:

```bash
node skills/export/scripts/install-skill.mjs --check
node skills/export/scripts/install-skill.mjs
```

The installer copies the manifest files into every existing agent root and
reports drift. The Freebuff account skill is updated separately through the
account skill library; it is not a filesystem root.

## Upstream checklist

1. `node --test "tests/*.test.mjs"`
2. `RUN_MERMAID=1 node --test tests/render.test.mjs`
3. `node skills/export/scripts/validate-release.mjs`
4. `node skills/export/scripts/install-skill.mjs --check`
5. Review `git diff --check` and the staged file list.
