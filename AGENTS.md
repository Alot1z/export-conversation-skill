# Repository rules

These rules apply to every contributor and every agent working in this repository. They are enforced by the commit-msg hook and the CI commit policy check.

## Commits

- Write the message in a file and commit with `git commit -F <file>`.
- Do not use a harness, editor or tool that appends attribution automatically.
- Never add `Co-Authored-By`, `Generated with Codebuff`, `Generated with Freebuff`, `noreply@codebuff.com` or any other tool attribution.
- Do not mention the agent, model or tooling in the subject or body. Public artifacts contain project information only.
- No emoji in commit messages, pull request titles or bodies, issues, documentation or code comments.
- Use a short imperative subject. Add a factual body only when the reason is not obvious.
- Run `npm test` before committing. The script lists every test file explicitly for Node 20 and does not rely on glob expansion.

Install the local hook once per clone:

```bash
npm run hooks:install
```

CI runs `node tools/check-commit-policy.mjs` and fails on a violation.

## Scope

- Keep each change focused on one problem.
- Add or update a test for every behavioral change.
- Do not weaken a test, a verification dimension or the dirty-worktree guard to make a check pass.
- Do not commit generated exports, `.export` data, secrets, credentials or machine-specific paths.
- Account-level skill updates are separate from this repository and require the owner's approval.

This policy follows the same rule as `/agent-principles`: a public artifact never carries agent provenance.
