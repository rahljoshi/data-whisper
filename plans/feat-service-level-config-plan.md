# Feature: Service-Level Config for CRUD Mode

## Goal
Remove `mode` and `confirm_write` from the API request body entirely. The operating mode is configured once at the service level via environment variables. The write confirmation flow moves to a two-endpoint design: `POST /api/query` returns a `confirmation_token` for destructive operations; `POST /api/query/confirm` executes the confirmed write using that token.

---

## TODOs

- [x] Add `QUERY_MODE` env var to config (`READ_ONLY` | `CRUD_ENABLED`, default `READ_ONLY`)
- [x] Add `PENDING_WRITE_TTL_SECONDS` env var to config (default `300`)
- [x] Simplify `QueryRequest` to `{ query: string }` — remove `mode` and `confirm_write`
- [x] Add `ConfirmWriteRequest: { token: string }` type
- [x] Add `confirmation_token` field to `WriteConfirmationResponse`
- [x] Create `pendingWriteStore.ts`: store/retrieve pending writes by UUID token in Redis with in-memory fallback
- [x] Refactor `query.route.ts`: read mode from `config.query.mode`, generate token for UPDATE/DELETE, store pending write
- [x] Add `POST /api/query/confirm` endpoint: look up token, execute stored SQL, return `{ type: WRITE, affected_rows }`
- [x] Update route tests: remove mode/confirm_write from payloads, add /confirm endpoint tests
- [x] Update README, `.env.example`, and plan archive

---

## Acceptance Criteria

### API Contract
- `POST /api/query` accepts only `{ "query": "..." }` — no mode, no confirm_write
- `POST /api/query/confirm` accepts `{ "token": "..." }`

### Service Config
| Variable | Default | Description |
|---|---|---|
| `QUERY_MODE` | `READ_ONLY` | `READ_ONLY` or `CRUD_ENABLED` |
| `PENDING_WRITE_TTL_SECONDS` | `300` | Token expiry in seconds |

### Flow
- UPDATE/DELETE → dry-run preview returned with `confirmation_token`, nothing executed
- Token stored in Redis (TTL = `PENDING_WRITE_TTL_SECONDS`), falls back to in-memory map
- Token is single-use — consumed on `/api/query/confirm` call
- `/api/query/confirm` with expired/unknown token → `404 TOKEN_NOT_FOUND`
- INSERT → executes immediately, no token required

### Mode Enforcement
- `mode` from any request body is silently stripped (Fastify `additionalProperties: false`)
- Route always reads mode from `config.query.mode` — caller has no influence

---

## Test Plan

### `pendingWriteStore`
- `storePendingWrite` returns a unique UUID token per call
- `getPendingWrite` returns the stored payload by token
- Token is consumed on read (cannot be retrieved twice)
- Returns null for unknown tokens
- In-memory fallback works without Redis
- Redis errors return null gracefully

### Route — `/api/query`
- Passes `config.query.mode` to `generateSql`, not any body field
- DELETE/UPDATE always return `AWAITING_CONFIRMATION` with `confirmation_token`
- Stores pending write via `storePendingWrite`
- Does NOT execute the write SQL — only the preview SELECT
- INSERT executes directly

### Route — `/api/query/confirm`
- Retrieves pending write by token and executes it
- Returns `{ type: WRITE, affected_rows }`
- Returns 404 for unknown/expired token
- Returns 400 for missing token field

---

## Architecture Notes
- `pendingWriteStore` is decoupled from the general query cache (`cacheService`)
- Redis key prefix: `data-whisper:pending-write:<token>`
- In-memory fallback uses `Map<string, { value, expiresAt }>` with lazy expiry on read
- Token = `crypto.randomUUID()` (Node.js built-in, no extra dependency)
