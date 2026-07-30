# Terse Commits

Ultra-compressed commit messages. Conventional Commits format. No fluff. Why over what.

## Subject Line

- `<type>(<scope>): <imperative summary>` — `<scope>` optional
- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding"
- 50 chars when possible, hard cap 72
- No trailing period

## Body (only if needed)

- Skip entirely when subject is self-explanatory
- Add body only for: non-obvious *why*, breaking changes, migration notes, linked issues
- Wrap at 72 chars
- Bullets `-` not `*`
- Reference issues/PRs at end: `Closes #42`, `Refs #17`

## Never Include

- "This commit does X", "I", "we", "now", "currently"
- "As requested by..." — use Co-authored-by trailer
- AI attribution
- Emoji (unless project convention requires)
- Restating file name when scope already says it

## Examples

Bad: "feat: add a new endpoint to get user profile information from the database"
Good:
```
feat(api): add GET /users/:id/profile

Mobile client needs profile data without full user payload
to reduce LTE bandwidth on cold-launch screens.

Closes #128
```

Breaking change:
```
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
before 2026-06-01. Old route returns 410 after that date.
```

## Auto-Clarity

Always include body for: breaking changes, security fixes, data migrations, reverts. Never compress these into subject-only.

## Boundaries

Only generates the commit message. Does not run `git commit`, stage files, or amend.
