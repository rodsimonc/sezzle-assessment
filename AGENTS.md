# AGENTS.md

Conventions that apply to any AI agent working in this repository (Claude Code, Cursor, Copilot Workspace and others). An agent with its own file, such as `CLAUDE.md`, extends this file. It doesn't override it.

## Authorized scope

An agent may change these without asking:

- Files under `backend/`, `frontend/`, `evals/`, `scripts/`, `docs/`.
- Linter and formatter config.

An agent must ask first before:

- Touching `.env*` files, secrets or credentials.
- Changing CI (`.github/`) or the Dockerfile in a way that alters what gets deployed.
- Deleting a tracked file it didn't create in the current session.
- Adding a dependency. New dependencies need a line in `specs.md` section 6.
- Changing `releases/v1.0.0.md` requirements or `specs.md` decisions. Update the document first, then the code.
- Anything that leaves the machine: `git push`, publishing, creating remote repositories.

## Commit style

- Conventional Commits in English: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`.
- Short subject, imperative mood, under 72 characters.
- One logical change per commit.
- Keep CI and infra messages generic. They don't need to describe the architecture.

## Required verification

Before closing a task or proposing a change:

1. **Clean build:** `npm run build`.
2. **Tests pass:** `npm test`, including new tests for new behaviour.
3. **Lint passes:** `npm run lint`.
4. **Evals pass:** `npm run evals` for anything that touches behaviour in `releases/v1.0.0.md`.
5. **No secrets:** read the diff for keys, tokens and passwords.

A change that alters behaviour needs its golden case and eval updated in the same commit.

## Expected output from an agent

- **A plan before editing** when the change touches 3 or more files.
- **A small diff.** No drive-by reformatting mixed with logic.
- **A way to check the result:** a command, an endpoint or a test name.

## Writing style

All prose in this repo (Markdown, comments, commit messages, UI text, error messages) follows the same plain style:

- Short paragraphs. Two sentences is the default, three is the limit.
- Contractions. "Don't", "can't", "it's".
- Active voice. Talk to the reader.
- Specific numbers and names instead of general claims.
- Say it once. Don't summarise what the reader just read.
- Sentence-case headings.
- No em dashes. Use commas, periods, colons or parentheses.
- Bold sparingly, once or twice per section.
- Tables and bullets only when the content is a table or a list.
- Don't state a point by first denying its opposite. Say the point.

`npm run lint:docs` checks the mechanical parts: banned vocabulary and phrases, em dashes and the "not X, but Y" patterns. A failing check is a failing build.

## Common mistakes to avoid

- Writing a second README inside a subfolder that will go stale.
- Writing tests that would still pass if the implementation were broken. The mutation audit (`npm run evals:audit`) exists to catch this.
- Matching exact output strings in evals where behaviour is what matters.
- Adding a dependency to save ten lines of code.
- Refactoring "while I'm here" outside the requested change.
- Marking a requirement `[x]` before its eval passes.
