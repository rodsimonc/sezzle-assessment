# Releasing

This is the checklist for cutting a release. The current release is 1.0.0, and its requirements live in [releases/v1.0.0.md](./releases/v1.0.0.md).

## Version rule

Every place that names a version must name the same one. A mismatch blocks the release.

The version appears in:

- `package.json` (root), `frontend/package.json` and `evals/package.json`
- `backend/internal/version/version.go`
- `backend/api/openapi.yaml` (`info.version`)
- the `GET /healthz` response
- the `## [X.Y.Z] - YYYY-MM-DD` heading in [CHANGELOG.md](./CHANGELOG.md)
- the Docker tag in `package.json` (`docker:build`, `docker:run`)

## Pre-release

1. Confirm every requirement in `releases/v1.0.0.md` is checked.
2. Move the `[Unreleased]` entries into a new `## [X.Y.Z] - YYYY-MM-DD` section in CHANGELOG.md. Leave `[Unreleased]` empty.
3. Update every version string listed above.
4. Run `git status --porcelain`. The output must be empty before you tag.
5. Run `npm run check:all`. Every step must pass.

## Build

1. Run `npm ci` in a clean checkout.
2. Run `npm run build`. It writes `frontend/dist` and `backend/bin/server`.
3. Run `npm run diagrams` if a Mermaid source changed. It skips PNGs that are newer than their source.

## Verification

1. Run `npm run coverage`. Both gates must pass: backend 90%, frontend 80%. The report lands in `docs/coverage/SUMMARY.md`.
2. Run `npm run evals`. Every API and UI eval must pass.
3. Run `npm run evals:coverage` and confirm the table has no gaps for v1.0.0.
4. Run `docker build -t calculator:1.0.0 .` and `npm run docker:run`. Open `http://localhost:8080` and `http://localhost:8080/healthz`.

## Post-release

1. Change the status line in `releases/v1.0.0.md` to `Published - YYYY-MM-DD`.
2. Create the tag `vX.Y.Z` on the release commit. Push the tag.
3. Move deferred items into [BACKLOG.md](./BACKLOG.md).

## Hotfix

1. Branch from the tag, not from `main`.
2. Fix the defect and add a golden case or a test that fails before the fix.
3. Bump the patch version everywhere in the version rule. Add a `## [X.Y.Z+1]` section to the changelog.
4. Run `npm run check:all` again, then tag and push.

## Incident

1. Roll back the deployment to the previous image tag. The repository has no production target, so the rollback is a rerun of `docker run` with the previous tag.
2. Record the failing request, the version and the log lines in a new CHANGELOG entry under `[Unreleased]`.
3. Follow the hotfix steps once the cause is known.
