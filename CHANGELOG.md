# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-09

### Added

- Go calculator service with add, subtract, multiply, divide, power and square root. Results round to 15 significant digits.
- Versioned REST API at `/api/v1/calculations`, described by `backend/api/openapi.yaml` and served as `/api/v1/openapi.yaml`.
- Problem Details (RFC 7807) errors with a stable code per failure. Shape errors return 400 or 415, rule errors return 422.
- Middleware for request IDs, panic recovery, security headers, request logging, CORS, rate limiting and body size limits.
- `GET /healthz` that reports the service version.
- React and TypeScript keypad that sends every operation to the API. The frontend does no arithmetic.
- Calculation history kept in `localStorage`.
- Single Docker image that serves the API and the built frontend.
- Backend unit tests, frontend unit tests, API and UI evals, and coverage gates at 90% for the backend and 80% for the frontend.
- Lint pipeline with gofmt, go vet, golangci-lint, ESLint, Prettier, tsc and a docs style check.
- Scripts for link checks, coverage reports, backend linting and diagram export.
- Contract documents: `specs.md`, `releases/v1.0.0.md`, `docs/ERROR-CONTRACT.md` and `AGENTS.md`.
