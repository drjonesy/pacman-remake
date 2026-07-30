# Compress Docs

Compress natural language files (.md, .txt) into terse format to save input tokens. Preserve all technical substance.

## Process

1. Back up original as `<filename>.original.md`
2. Compress prose sections only
3. Overwrite original with compressed version

## Remove

- Articles: a, an, the
- Filler: just, really, basically, actually, simply, essentially, generally
- Pleasantries: "sure", "certainly", "of course", "happy to"
- Hedging: "it might be worth", "you could consider"
- Redundant phrasing: "in order to" -> "to", "make sure to" -> "ensure"
- Connective fluff: however, furthermore, additionally

## Preserve Exactly (never modify)

- Code blocks (fenced and indented)
- Inline code (backtick content)
- URLs, links, file paths
- Commands (`npm install`, `git commit`)
- Technical terms, library names, API names
- Proper nouns, dates, version numbers
- Environment variables

## Preserve Structure

- All markdown headings (compress body below, not heading text)
- Bullet hierarchy and nesting
- Numbered lists
- Tables (compress cell text, keep structure)
- Frontmatter/YAML headers

## Compress

- Short synonyms: "big" not "extensive", "fix" not "implement a solution for"
- Fragments OK: "Run tests before commit" not "You should always run tests before committing"
- Drop "you should", "make sure to", "remember to" — just state action
- Merge redundant bullets saying same thing differently
- Keep one example where multiple show same pattern

## Example

Original:
> You should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.

Compressed:
> Run tests before push to main. Catch bugs early, prevent broken prod deploys.

## Boundaries

- ONLY compress natural language files (.md, .txt)
- NEVER modify: .py, .js, .ts, .json, .yaml, .yml, .toml, .env, .lock, .css, .html, .xml, .sql, .sh
- Mixed content (prose + code): compress ONLY prose sections
- If unsure whether something is code or prose, leave unchanged
- Never compress .original.md backup files
