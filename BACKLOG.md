# Backlog

Work that is out of scope for the current release lands here. Each item names the reason it was deferred, so a later release can pick it up without re-deriving the decision.

## Items

| Item | Why deferred | Notes |
| --- | --- | --- |
| Exact decimal mode | The v1.0.0 contract uses float64 arithmetic and rounds to 15 significant digits. | Needs a decimal type in `domain` and a contract change in `specs.md`. |
| Modulo operation | Not in the v1.0.0 operation list. | Add the operation to the API, the keypad and the evals together. |
| Server-side history behind auth | v1.0.0 has no accounts. History lives in `localStorage`. | Depends on an auth design that the release does not include. |
| Distributed rate limiting | v1.0.0 runs as one instance, so an in-memory limiter is enough. | Needs a shared store such as Redis, and a new dependency entry in `specs.md`. |
| i18n and theme toggle | The UI ships in English with one theme. | Extract strings first, then add the toggle. |
| OpenTelemetry metrics | Logging covers the v1.0.0 needs. | Add traces and metrics once a deployment target exists. |
| Swagger UI page | `openapi.yaml` is served as a file. | A UI page adds a frontend dependency, so it waits for a use case. |
| Signed images and an SBOM | No release pipeline publishes images yet. | Sign the image and attach an SBOM in the CI release job. |
| 16-digit integer exactness | Integers above 2^53 lose precision in float64. | Pairs with the exact decimal mode item. |

## Adding an item

Put the item in the table with its reason. Link to the requirement or the decision that blocks it. Do not add an item that the release file already covers.
