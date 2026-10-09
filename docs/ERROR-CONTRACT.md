# Error contract

Every error response is Problem Details (RFC 7807) with the content type `application/problem+json`. One shape, no exceptions. That includes errors from the router (404, 405), the middleware (413, 415, 429) and the panic handler (500).

## Shape

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Division by zero is undefined.",
  "instance": "/api/v1/calculations",
  "code": "DIVISION_BY_ZERO",
  "requestId": "3f9c2b7a1d4e8f60a5b2c9d1e7f3a408"
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | yes | Always `about:blank`. The status and `code` carry the meaning. |
| `title` | yes | Fixed text for the status. See the table below. |
| `status` | yes | The HTTP status, repeated in the body. |
| `detail` | yes | One sentence for this occurrence. Safe to show to a user. |
| `instance` | yes | The request path that failed. |
| `code` | yes | Stable machine-readable code. Clients branch on this, never on `detail`. |
| `requestId` | yes | Same value as the `X-Request-Id` response header. |
| `errors` | no | Field-level problems: `[{ "field": "operands", "message": "..." }]`. Present on 400 `INVALID_REQUEST`, 400 `INVALID_OPERAND_COUNT` and 422 `UNKNOWN_OPERATION` from the body. |
| `retryAfter` | no | Whole seconds. Only on 429, and equal to the `Retry-After` header. |

Titles come from a fixed table in the backend, not from `http.StatusText`, so they can't change with a Go upgrade.

| Status | Title |
|--------|-------|
| 400 | Bad Request |
| 403 | Forbidden |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 413 | Content Too Large |
| 415 | Unsupported Media Type |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

## 400 or 422?

The reference blocks for this project draw the line like this:

- **400** means the request can't be understood. Bad JSON, wrong types, missing fields, unknown fields, a wrong operand count.
- **422** means the request is understood and the answer is "no". Dividing by zero, a negative square root, an unknown operation name in the body.

An unknown operation name in a URL path (`/api/v1/operations/modulo`) is a missing resource, so it returns 404.

## Codes

| Code | Status | `detail` | When |
|------|--------|----------|------|
| `INVALID_JSON` | 400 | The request body isn't valid JSON. | Empty body, syntax error, or extra data after the JSON value. |
| `INVALID_REQUEST` | 400 | The request body is invalid. | Not an object, missing or mistyped `operation` or `operands`, a non-number operand, an unknown field, or a number outside the float64 range. `errors` names the field. |
| `INVALID_OPERAND_COUNT` | 400 | The request has the wrong number of operands. | `operands` length doesn't match the operation. `errors[0].message` reads `add needs 2 operands, got 1.` or `sqrt needs 1 operand, got 2.` |
| `UNKNOWN_OPERATION` | 422 | `Unknown operation "modulo".` | Body route. `errors[0].field` is `operation` and the message lists the valid names. |
| `UNKNOWN_OPERATION` | 404 | `Unknown operation "modulo".` | Path route `/api/v1/operations/{name}`. No `errors`. |
| `DIVISION_BY_ZERO` | 422 | Division by zero is undefined. | `divide` with a zero divisor, `reciprocal` of 0, `power` of 0 to a negative exponent. |
| `NEGATIVE_SQUARE_ROOT` | 422 | The square root of a negative number isn't a real number. | `sqrt` of a negative operand. |
| `UNDEFINED_RESULT` | 422 | The result isn't a real number. | `power` of a negative base to a non-integer exponent, or any other NaN. |
| `RESULT_OUT_OF_RANGE` | 422 | The result is too large to represent. | The result is infinite after the operation. |
| `NOT_FOUND` | 404 | `No route matches GET /api/v1/nothing.` | Unknown path. |
| `METHOD_NOT_ALLOWED` | 405 | `PUT isn't allowed on /api/v1/calculations. Allowed: POST.` | Known path, wrong method. The `Allow` header lists the methods. |
| `PAYLOAD_TOO_LARGE` | 413 | The request body must be 4096 bytes or smaller. | Body over 4096 bytes. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type must be application/json. | Missing or different `Content-Type`. Parameters such as `charset=utf-8` are fine. |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | Origin isn't allowed. | Preflight request from an origin outside `CORS_ALLOWED_ORIGINS`. |
| `RATE_LIMITED` | 429 | `Too many requests. Try again in 1 second.` or `... in N seconds.` | Client went over the limit. Sets `Retry-After` and `retryAfter`. |
| `INTERNAL_ERROR` | 500 | Something went wrong on our side. Quote the request id if you report it. | A recovered panic or any unexpected failure. Never includes internals. |

## Example: field errors

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "The request body is invalid.",
  "instance": "/api/v1/calculations",
  "code": "INVALID_REQUEST",
  "requestId": "3f9c2b7a1d4e8f60a5b2c9d1e7f3a408",
  "errors": [
    { "field": "operands", "message": "must be an array of numbers." }
  ]
}
```

## Example: rate limit

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 1
X-Request-Id: 3f9c2b7a1d4e8f60a5b2c9d1e7f3a408
```

```json
{
  "type": "about:blank",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Too many requests. Try again in 1 second.",
  "instance": "/api/v1/calculations",
  "code": "RATE_LIMITED",
  "requestId": "3f9c2b7a1d4e8f60a5b2c9d1e7f3a408",
  "retryAfter": 1
}
```

## Rules for adding a code

1. Add the code to this table and to the `code` enum in `backend/api/openapi.yaml`.
2. Add one golden case to the release file that introduces it.
3. Add the eval before the implementation (see `releases/v1.0.0.md`).
4. Never reuse a retired code for a new meaning.
