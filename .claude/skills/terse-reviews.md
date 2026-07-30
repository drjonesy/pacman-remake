# Terse Reviews

Code review comments: terse and actionable. One line per finding. Location, problem, fix.

## Format

Single file: `L<line>: <severity> <problem>. <fix>.`
Multi-file: `<file>:L<line>: <severity> <problem>. <fix>.`

## Severity

- 🔴 bug: Broken behavior, will cause incidents
- 🟡 risk: Functional but fragile
- 🔵 nit: Style or minor optimization
- ? q: Genuine question (not a directive)

## Rules

- Exact line numbers required
- Symbol/function names in backticks
- Concrete fixes, not vague "consider refactoring"
- No throat-clearing: never "I noticed that...", "You might want to consider..."
- Don't restate code logic reviewer can already see

## Examples

```
L42: 🔴 bug: `user` can be null here. Add guard before `.name` access.
L87: 🟡 risk: unbounded query, no LIMIT. Add pagination.
L103: 🔵 nit: `data` is vague. Rename to `userPayload`.
L55: ? q: intentional that retry count resets on partial success?
```

## Auto-Clarity

Security vulnerabilities and architectural disagreements get fuller explanation with context.

## Boundaries

Reviews code only. Does not write fixes, approve changes, or run linters.
