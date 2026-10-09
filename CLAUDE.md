# CLAUDE.md

Context for Claude Code and any compatible agent working in this repository. Keep it short, specific and checkable.

## Project summary

A calculator. A Go microservice (standard library only) does the arithmetic behind a versioned REST API. A React + TypeScript keypad app consumes it. One Docker image runs both. Built for a take-home assessment, so design, tests and docs count as much as features.

## Frequent commands

Run from the repo root. They work on Windows, macOS and Linux.

```bash
npm ci                  # install everything (frontend and evals workspaces)
npm run dev             # backend :8080 + Vite :5173
npm test                # backend and frontend unit tests
npm run coverage        # tests with coverage gates and the docs/coverage snapshot
npm run lint            # gofmt, go vet, golangci-lint, ESLint, Prettier, tsc, docs style
npm run build           # frontend/dist and backend/bin/server
npm run evals           # API and UI evals against the built binary
npm run evals:coverage  # eval coverage table for the current release
npm run check           # lint + test + coverage + build + evals + evals:coverage
npm run check:all       # check + audit + mutation audit + Docker evals
```

On Windows, if `go` isn't found in a shell that was open before Go was installed, add `C:\Program Files\Go\bin` to `PATH` or open a new shell.

## Architecture on one screen

- **Backend layers:** `handler` (HTTP only) calls `service` (validation, dispatch, rounding) calls `domain` (pure arithmetic, no `net/http`). `middleware`, `problem`, `config` and `server` support them.
- **Frontend layers:** `components` render. `calculator/reducer` is a pure state machine. `calculator/useCalculator` wires the reducer to the API client. `history` wraps `localStorage`.
- **The frontend does no arithmetic.** Every computed number comes back from the API.
- **HTTP contract:** `backend/api/openapi.yaml` and `docs/ERROR-CONTRACT.md`. Errors are Problem Details. 400 is for shape, 422 is for rules.
- **Lifecycle contract:** `releases/v1.0.0.md` lists every requirement with a golden case and an eval file. `specs.md` holds the stack and the closed decisions.

## Code conventions

- English for identifiers, comments, UI text and commits.
- Go: standard library only at runtime. One concern per file. Table-driven tests. `gofmt` clean.
- TypeScript: `strict`, no `any`, no `@ts-ignore`, named exports, tests next to the file.
- JSON keys are camelCase. No null fields.
- Exact dependency versions only. No `^`, `~` or `latest`.
- Comments say why, not what.
- Docs follow the writing rules in `AGENTS.md`. `npm run lint:docs` enforces them.

## What to avoid

- No arithmetic in handlers or in the frontend.
- No service that only forwards a call.
- No shared package until a second consumer needs it.
- No new dependency without a line in `specs.md` section 6.
- No `console.log`, `fmt.Print` or debug leftovers in delivered code.
- No scope creep. Anything not in `releases/v1.0.0.md` goes to `BACKLOG.md`.

## Cross references

- [AGENTS.md](./AGENTS.md) for conventions that apply to every agent.
- [specs.md](./specs.md) for the stack, structure and closed decisions.
- [releases/v1.0.0.md](./releases/v1.0.0.md) for requirements, golden cases and the UI contract.
- [RELEASING.md](./RELEASING.md) for the release checklist.
