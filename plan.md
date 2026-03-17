# Feature: Read vs CRUD Mode

## Goal
Extend the NL→SQL pipeline with a configurable `mode` field that controls whether write operations are allowed. In `CRUD_ENABLED` mode, the system supports INSERT/UPDATE/DELETE with AST-level safety checks. Destructive writes (UPDATE/DELETE) require explicit confirmation via a dry-run preview flow.

---

## TODOs

- [x] Create `plan.md` and commit
- [x] Update types: `QueryRequest`, `QueryResponse`, `WriteConfirmationResponse`, new error codes
- [x] Update `sqlGenerator` to emit mode-aware system prompts
- [x] Update `sqlValidator` for CRUD mode: allow INSERT/UPDATE/DELETE, enforce WHERE, reject DROP/ALTER/TRUNCATE
- [x] Implement write confirmation flow in route: dry-run preview, `AWAITING_CONFIRMATION` response, `confirm_write` gate
- [x] Write tests for mode-aware `sqlGenerator`
- [x] Write tests for CRUD-mode `sqlValidator`
- [x] Write tests for write confirmation flow in route
- [x] Update `README.md` with new API docs
- [x] Cleanup pass: remove dead code, unused imports, ensure full test pass

### Service-level refactor
- [x] Move `mode` to service config (`QUERY_MODE` env var) — remove from request body
- [x] Move `confirm_write` to two-endpoint flow — remove from request body
- [x] Add `PENDING_WRITE_TTL_SECONDS` config, `pendingWriteStore.ts` (Redis-backed with in-memory fallback)
- [x] Add `POST /api/query/confirm` endpoint accepting `{ token }`
- [x] Update all tests and README

---

## Acceptance Criteria

### Input
```json
{
  "query": "<natural language>",
  "mode": "READ_ONLY | CRUD_ENABLED",
  "confirm_write": true
}
```
`mode` defaults to `READ_ONLY` if omitted.

### LLM Behavior
- `READ_ONLY`: only SELECT queries generated; auto-LIMIT 100
- `CRUD_ENABLED`: SELECT/INSERT/UPDATE/DELETE; no DROP/ALTER/TRUNCATE; UPDATE/DELETE must include WHERE; INSERT must name columns explicitly; SELECT auto-LIMIT 100

### AST Validation
- `READ_ONLY`: non-SELECT → `WRITE_NOT_ALLOWED`
- `CRUD_ENABLED`: DROP/ALTER/TRUNCATE → `WRITE_NOT_ALLOWED`; UPDATE/DELETE without WHERE → `MISSING_WHERE_CLAUSE`; unknown table/column → `SCHEMA_VIOLATION`

### Write Confirmation Flow
- UPDATE/DELETE without `confirm_write: true` → return `AWAITING_CONFIRMATION` with dry-run preview (real SELECT, max 10 rows)
- INSERT → execute directly, no confirmation required
- `confirm_write: true` → execute and return `affected_rows`

### Response Additions
- `type: "READ" | "WRITE"` on all success responses
- `affected_rows` on write responses

### Error Codes
| Code | When |
|------|------|
| `WRITE_NOT_ALLOWED` | Write attempted in READ_ONLY mode, or DROP/ALTER/TRUNCATE in any mode |
| `MISSING_WHERE_CLAUSE` | UPDATE or DELETE has no WHERE |
| `SCHEMA_VIOLATION` | Table or column not in schema (CRUD mode) |

---

## Test Plan

### `sqlGenerator`
- READ_ONLY prompt includes SELECT-only constraint language
- CRUD_ENABLED prompt includes INSERT/UPDATE/DELETE language
- Both modes: CANNOT_ANSWER, code fence stripping, injection blocking still work

### `sqlValidator`
- READ_ONLY: INSERT/UPDATE/DELETE throw `WRITE_NOT_ALLOWED`
- CRUD_ENABLED: SELECT/INSERT/UPDATE/DELETE (with WHERE) pass
- CRUD_ENABLED: DROP/ALTER/TRUNCATE throw `WRITE_NOT_ALLOWED`
- CRUD_ENABLED: UPDATE/DELETE without WHERE throw `MISSING_WHERE_CLAUSE`
- CRUD_ENABLED: unknown table/column throws `SCHEMA_VIOLATION`
- `buildPreviewSql`: DELETE → SELECT * FROM table WHERE ...; UPDATE → same

### Route
- READ_ONLY request returns `type: "READ"`
- CRUD INSERT executes directly, returns `type: "WRITE"`, `affected_rows`
- CRUD DELETE/UPDATE without `confirm_write` returns `AWAITING_CONFIRMATION` with preview
- CRUD DELETE/UPDATE with `confirm_write: true` executes, returns `type: "WRITE"`, `affected_rows`
- Missing `mode` defaults to `READ_ONLY`

---

## Architecture Notes
- `validateSql` return type changes from `string` to `{ sql: string; statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' }`
- `generateSql` gains a third `mode` parameter
- Cache lookup/write skipped for all WRITE operations
- `buildPreviewSql` exported from `sqlValidator` for use in route
