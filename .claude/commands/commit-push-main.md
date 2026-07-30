---
description: Commit staged/unstaged changes and push directly to main
---

Commit the current changes and push to `main`:

1. Run in parallel: `git status`, `git diff` (staged + unstaged), and `git log --oneline -5` to see recent commit message style.
2. Stage the relevant modified/untracked files by name (never `git add -A` or `git add .`). Skip anything that looks like a secret (`.env`, credentials, keys) and warn if asked to include one.
3. Draft a concise 1-2 sentence commit message focused on _why_, matching this repo's existing log style.
   Pass it via a heredoc (`git commit -m "$(cat <<'EOF' ... EOF)"`).
4. Confirm the branch is `main` (or ask before continuing if not).
5. Push with `git push origin main`.
6. Run `git status` to confirm the push succeeded and report the resulting commit hash.

If there are no changes to commit, say so and stop — do not create an empty commit or push with nothing new.
