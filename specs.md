# specs.md: Calculator

**Date:** 2026-10-09
**Owner:** @rodsimonc
**Contract version:** 0.1.1

This is the contract that came out of the specification interview. Every line is a decision. To change one, edit this file and bump the version in section 9 first.

---

## 1. Goal

A full-stack calculator. A React web app takes numbers and operations from the user. A Go microservice does all the arithmetic and answers in JSON. The frontend holds no arithmetic of its own.

Two kinds of people use it. One is a person doing quick math on a desktop or a phone. The other is a developer who calls the REST API directly.

It is also a take-home assessment, so the design, the tests and the docs matter as much as the features.

## 2. Stack

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| Backend language | Go | 1.27.2 | The brief prefers Go. Installed with winget on 2026-10-09 as 1.27.0. `go.mod` pins the 1.27.2 toolchain because `govulncheck` found standard library fixes in it. |
| Backend framework | Go standard library (`net/http`, `log/slog`) | 1.27.2 | Go 1.22+ routing covers every route here. Zero runtime dependencies. |
| Frontend runtime | Node.js | 22.23.2 | Already on the machine. Vite 8 and Vitest 5 need 22.12 or newer. |
| Package manager | npm | 10.9.8 | Ships with Node. pnpm and yarn aren't installed. |
| Frontend language | TypeScript (strict) | 6.0.3 | `typescript-eslint` 8.71.1 requires below 6.1.0, so TypeScript 7 is out. |
| Frontend framework | React | 19.3.0 | Required by the brief. |
| Frontend build | Vite | 8.3.4 | Fast dev server, built-in proxy, static output for Go to serve. |
| Frontend tests | Vitest + Testing Library | 5.0.3 / 16.3.3 | Same config as Vite. |
| Styling | Plain CSS with custom properties | n/a | No runtime cost. Light and dark come from `prefers-color-scheme`. |
| State | `useReducer` with a pure reducer | n/a | The calculator is a state machine. No store library needed. |
| Persistence | Browser `localStorage` (history only) | n/a | Keeps the backend stateless. |
| Auth | None | n/a | A calculator has no private data. |
| E2E and evals | Playwright Test | 1.64.0 | One runner for API evals, UI evals and delivery evals. |
| Diagrams | Mermaid sources, exported to PNG | 12.0.0 | Sources stay editable. Images show in any viewer. |
| Container | Docker, multi-stage | Engine 29.6.2 | One image runs the frontend and the backend. |
| CI | GitHub Actions | n/a | Workflow file only. It can't run on this machine. |

## 3. Folder structure

The tree below is the intended layout. Files may be added inside a listed folder when the folder's purpose calls for it. New top-level folders need a contract change.

```
Sezzle assesment/
├── .github/
│   └── workflows/ci.yml
├── backend/
│   ├── api/openapi.yaml              # OpenAPI 3.0.3, source of truth for the HTTP contract
│   ├── cmd/server/main.go            # entry point, 10 lines of wiring
│   ├── internal/
│   │   ├── config/                   # environment parsing and validation
│   │   ├── domain/                   # pure arithmetic and domain errors, no net/http
│   │   ├── service/                  # validation, dispatch, rounding, catalogue
│   │   ├── handler/                  # thin HTTP handlers and DTOs
│   │   ├── middleware/               # request id, logging, recover, headers, cors, rate limit, body limit
│   │   ├── problem/                  # RFC 7807 writer
│   │   ├── server/                   # router, static files, graceful shutdown
│   │   └── version/                  # the version constant
│   ├── .golangci.yml
│   └── go.mod                        # module "calculator"
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── api/                      # typed HTTP client and problem parsing
│   │   ├── calculator/               # pure reducer, key map, display formatting, controller hook
│   │   ├── components/               # Display, Keypad, Key, HistoryPanel, ErrorBanner
│   │   ├── history/                  # localStorage wrapper and hook
│   │   ├── styles/                   # tokens.css and app.css
│   │   └── test/                     # shared test setup and fixtures
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── eslint.config.js
│   └── .prettierrc.json
├── evals/
│   ├── lib/                          # server launcher, problem helpers, UI page object
│   ├── tools/                        # eval coverage report and mutation audit
│   ├── v1.0.0/
│   │   ├── api/                      # items 1.x and 2.x
│   │   ├── ui/                       # items 3.x
│   │   └── delivery/                 # items 4.x
│   ├── package.json
│   ├── playwright.config.ts
│   └── tsconfig.json
├── scripts/                          # plain Node ESM helpers called by npm scripts
├── docs/
│   ├── diagrams/                     # *.mmd sources and *.png exports
│   ├── images/                       # UI screenshots
│   ├── coverage/                     # committed coverage snapshot
│   └── ERROR-CONTRACT.md
├── releases/
│   └── v1.0.0.md
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── .gitignore
├── .npmrc
├── .nvmrc
├── AGENTS.md
├── BACKLOG.md
├── CHANGELOG.md
├── CLAUDE.md
├── LICENSE
├── README.md
├── RELEASING.md
├── package.json                      # npm workspaces: frontend, evals
├── package-lock.json
├── postman_collection.json
├── requests.http
└── specs.md
```

## 4. Conventions

- **Language:** English for docs, comments, UI text, commit messages and identifiers.
- **Go files:** lowercase names. The only `_` allowed is the `_test.go` suffix. Package names are single lowercase words.
- **Go roles:** types carry the role as a suffix when it helps: `CalculationRequest`, `CalculationResponse`, `OperationResponse`. One concern per file.
- **TypeScript files:** components in `PascalCase.tsx`, everything else in `camelCase.ts`. Tests sit next to the file as `*.test.ts` or `*.test.tsx`.
- **Exports:** named exports only. The one default export is the Vite config.
- **Imports:** relative. No path aliases.
- **JSON:** camelCase keys, no null fields, numbers as JSON numbers, dates in ISO 8601 (the only date is a history timestamp).
- **Errors:** every error response is Problem Details (RFC 7807) with `application/problem+json`. Shape errors return 400. Business-rule errors return 422. See `docs/ERROR-CONTRACT.md`.
- **Layers:** handler calls service, service calls domain. Handlers never do arithmetic. The domain never imports `net/http`. A service that only forwards a call isn't allowed.
- **Shared code:** a helper moves to a shared package only when a second consumer needs it.
- **Comments:** explain why, not what. Short.
- **Commits:** Conventional Commits in English (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`). One logical change per commit.
- **Writing style:** every Markdown file passes `npm run lint:docs`. Short paragraphs, contractions, no em dashes, sentence-case headings.
- **Versions:** exact pins only. No `^`, no `~`, no `latest`.

## 5. Scripts

All scripts run from the repo root. They work on Windows (PowerShell and cmd), macOS and Linux. Go commands use `go -C backend ...`.

| Script | What it does |
|--------|--------------|
| `dev` | Backend on :8080 and Vite on :5173 together. Vite proxies `/api` and `/healthz` to the backend. |
| `dev:backend`, `dev:frontend` | Each half alone. |
| `build` | Builds `frontend/dist` and `backend/bin/server` (`server.exe` on Windows). |
| `start` | Runs the built binary with `STATIC_DIR=frontend/dist`. |
| `test` | Backend unit tests, then frontend unit tests. |
| `coverage` | Both suites with coverage, gate checks, and a committed snapshot in `docs/coverage/`. |
| `lint` | gofmt check, go vet, golangci-lint, ESLint, Prettier check, tsc, and `lint:docs`. |
| `lint:docs` | Writing-style check and relative-link check on all Markdown. |
| `audit` | govulncheck and `npm audit --audit-level=high`. |
| `evals` | Builds, then runs the API evals and the UI evals. |
| `evals:api`, `evals:ui`, `evals:delivery` | One layer each. |
| `evals:coverage` | Prints the eval coverage table for the current release. Fails under 100%. |
| `evals:audit` | Mutation audit. Breaks the backend on purpose and checks the evals notice. |
| `e2e` | Alias for `evals:ui`. |
| `diagrams` | Exports every `docs/diagrams/*.mmd` to PNG. |
| `docker:build`, `docker:run` | Build and run the image. |
| `check` | lint, test, coverage, build, evals, evals:coverage. |
| `check:all` | `check` plus audit, evals:audit, evals:delivery (Docker). |

## 6. Dependencies

Exact pins. If an install shows a peer conflict, step down to the newest compatible version, record it here, and bump the contract.

```
# Backend: none at runtime. Go standard library only.
# Backend tooling, run with `go run` at a pinned version
github.com/golangci/golangci-lint/v2  @ v2.14.0
golang.org/x/vuln (govulncheck)       @ v1.8.0

# Frontend production
react                                  @ 19.3.0
react-dom                              @ 19.3.0

# Frontend development
typescript                             @ 6.0.3
vite                                   @ 8.3.4
@vitejs/plugin-react                   @ 6.1.2
vitest                                 @ 5.0.3
@vitest/coverage-v8                    @ 5.0.3
jsdom                                  @ 30.1.2
@testing-library/react                 @ 16.3.3
@testing-library/dom                   @ 10.4.2
@testing-library/user-event            @ 14.6.7
@testing-library/jest-dom              @ 7.0.1
@types/react                           @ 19.3.0
@types/react-dom                       @ 19.3.0
@types/node                            @ 22.20.5
eslint                                 @ 10.12.0
@eslint/js                             @ 10.0.1
typescript-eslint                      @ 8.71.1
eslint-plugin-react-hooks              @ 7.1.1
eslint-plugin-react-refresh            @ 0.5.7
globals                                @ 17.13.0
prettier                               @ 3.9.9

# Evals workspace
@playwright/test                       @ 1.64.0
@axe-core/playwright                   @ 4.13.0
yaml                                   @ 2.9.1
tsx                                    @ 4.23.15
@types/node                            @ 22.20.5

# Root tooling
concurrently                           @ 10.0.6
@mermaid-js/mermaid-cli                @ 12.0.0
puppeteer                              @ 25.13.0

# Resolution override (root package.json "overrides")
@zenuml/core > playwright-core         @ 1.64.0
```

`@mermaid-js/mermaid-cli` 12.0.0 pulls in `@zenuml/core` 3.50.1, which lists `playwright-core` 1.57.0 as an optional peer. `npm install` accepts that beside the 1.64.0 from `@playwright/test`, but `npm ci` rejects the lockfile. The override sets the peer to 1.64.0. No pin above changed.

Docker base images are pinned by exact tag in the Dockerfile and recorded in the README.

## 7. Closed decisions

### From the interview

- **Go toolchain:** Go 1.27.0 installed with winget. `go.mod` selects 1.27.2, which Go downloads on first use. No Docker-only fallback.
- **Location:** `C:\Users\rodsi\Desktop\Tupro\desarrollo web y movil\Sezzle assesment`, next to the other projects, with its own git repository.
- **Language:** English everywhere.
- **Structure to follow:** AIDLC 10X files, REST conventions, layered architecture, eval suite. All four.
- **API shape:** both styles. `POST /api/v1/calculations` with `{operation, operands}`, plus `GET /api/v1/operations` and `POST /api/v1/operations/{name}`. They share one service.
- **Operations:** add, subtract, multiply, divide, power, sqrt, percentage, reciprocal, square. Modulo isn't included.
- **Percentage meaning:** `percentage(a, b)` is a percent of b. 15 and 200 give 30.
- **Number model:** `float64`. Results round to **15 significant digits**.
  - The interview text said 12. 15 is the right number: 12 would turn `999999999999 + 999999999999` into `2000000000000`. 15 still cleans float noise (`0.1 + 0.2` gives `0.3`).
- **UI:** pocket keypad.
- **Calculator keys:** core keys (AC, backspace, decimal point, negate, keyboard input), chained calculations with repeat-equals, memory keys (MC, MR, M+, M-), and unary keys (1/x, x²).
- **History:** browser `localStorage`, last 50 results. The backend stays stateless.
- **Extra checks:** Playwright E2E, GitHub Actions CI, linters and type checks, security scans.
- **Diagrams:** Mermaid sources plus exported PNGs.

### Defaults I set (not asked, change them here if you disagree)

- **Docker:** one multi-stage Dockerfile. The Go binary serves the built React app and the API on port 8080. A `docker-compose.yml` wraps that one service.
- **Backend hardening:** rate limiting (429 with `Retry-After`), security headers and a strict CSP, CORS allowlist (empty by default), health endpoint, structured JSON logs with request ids, graceful shutdown, 4 KiB body limit.
- **Coverage gates:** backend 90% of statements, frontend 80% for lines, branches, functions and statements.
- **Ports:** backend 8080, Vite dev server 5173.
- **License:** MIT.
- **Git:** local repository only. Nothing is pushed and no GitHub repository is created. Branch `main`. Conventional Commits. Tag `v1.0.0` at the end.
- **Versions:** every manifest, the OpenAPI `info.version`, `/healthz` and the CHANGELOG say `1.0.0` from the start. The Operation phase checks they still match.
- **Memory keys:** the memory value lives in React state and resets on reload. History persists, memory doesn't.
- **Arithmetic on the server only:** even M+ and M- go through the API (`add` and `subtract`). Negate is string editing and needs no API call.
- **Theme:** follows `prefers-color-scheme`. No manual toggle.
- **Project folder name:** `Sezzle assesment`, spelled as given.

## 8. Out of scope (v1.0.0)

- Modulo and any operation beyond the nine listed.
- Expression parsing with parentheses.
- Accounts, auth and server-side history.
- Internationalisation and a manual theme toggle.
- Exact decimal arithmetic. See the BACKLOG.
- Pushing to GitHub or deploying anywhere.
- Mobile apps.

## 9. Contract history

- **0.1.0 (2026-10-09):** first version, written from the interview. Scaffolding proceeds.
- **0.1.1 (2026-10-09):** scaffolding found that `npm ci` failed on an optional peer of `@zenuml/core`. Section 6 now records a root `overrides` entry. No pin changed.

---

**Approval:** the owner confirmed the interview answers in chat on 2026-10-09 and asked for the build to proceed. The defaults in section 7 are open to change until the release closes.
