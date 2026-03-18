# data-whisper

A production-grade Natural Language to SQL engine. Send a plain-English question, get back the SQL query, an explanation, and the results — all validated at the AST level before touching your database.

Supports **READ_ONLY** mode (SELECT-only, safe for analytics) and **CRUD_ENABLED** mode (INSERT/UPDATE/DELETE with mandatory WHERE enforcement and a write-confirmation flow for destructive operations).

---

## Features

- **NL → SQL via OpenAI** — mode-aware system prompts enforce SELECT-only or full CRUD output
- **AST-level security** — `node-sql-parser` blocks disallowed statements before execution; no regex
- **Read vs CRUD mode** — `QUERY_MODE=READ_ONLY` (default) or `QUERY_MODE=CRUD_ENABLED`; configured at the service level, not per-request
- **Write confirmation flow** — UPDATE/DELETE always return a dry-run preview first; execution requires a second call to `/api/query/confirm`
- **Query history + replay** — every query (success and failure) is stored; replay by history ID re-runs the full pipeline
- **Schema versioning** — full SHA-256 hash of schema (tables + columns + types), stored in Redis as `schema:version`; schema changes logged as `SCHEMA_CHANGED`
- **Per-route rate limiting** — route-specific limits via `@fastify/rate-limit` backed by Redis
- **Structured pino logging** — every request logs `request_id`, `event`, latency fields, and pipeline milestones
- **Metrics endpoint** — aggregated query stats computed live from `query_history`
- **RBAC** — role-based table access (admin / analyst / readonly) via `X-User-Id` / `X-User-Role` headers
- **Query cost estimation** — EXPLAIN is run before SELECT execution; queries exceeding cost or seq-scan thresholds are rejected
- **Feedback loop** — thumbs-up/down per query history entry, with stats endpoint
- **Redis caching** — identical SELECT questions return cached results instantly (1-hour TTL)
- **5-second query timeout** — runaway queries are killed automatically
- **Graceful Redis degradation** — cache failures never bring down the service
- **Structured error responses** — every error includes a machine-readable `type` field

---

## Stack

| Layer | Technology |
|---|---|
| HTTP Framework | Fastify 5 |
| Language | TypeScript 5 |
| AI | OpenAI API (gpt-4o / gpt-4.1 / gpt-5) |
| Database | PostgreSQL (pg pool) |
| Cache | Redis (ioredis) |
| SQL Parsing | node-sql-parser |
| Config Validation | Zod |
| Logging | pino (built into Fastify) |

---

## Prerequisites

- Node.js >= 18
- PostgreSQL (any version with `information_schema`)
- Redis (optional — service degrades gracefully without it)
- An OpenAI API key

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
REDIS_URL=redis://localhost:6379
```

### 3. Run migrations

Apply the SQL migrations in order:

```bash
psql -U <user> -d <database> -f src/migrations/001_query_history.sql
psql -U <user> -d <database> -f src/migrations/002_rbac_roles.sql
psql -U <user> -d <database> -f src/migrations/003_query_feedback.sql
```

### 4. Load mock data (optional but recommended)

A full seed file is provided with 8 tables and realistic e-commerce data:

```bash
psql -U <user> -d <database> -f database/seed.sql
```

This creates: `departments`, `employees`, `categories`, `products`, `customers`, `orders`, `order_items`, `reviews` — with ~200 rows across all tables.

See [`database/example-queries.md`](database/example-queries.md) for 40+ ready-to-use natural language test questions.

### 5. Build

```bash
npm run build
```

### 6. Start

```bash
# Production
npm start

# Development (hot reload)
npm run dev
```

The server starts on `http://localhost:3000` by default.

---

## Environment Variables

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key |
| `DATABASE_URL` | **Yes*** | — | Full PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `PORT` | No | `3000` | HTTP port |
| `HOST` | No | `0.0.0.0` | HTTP bind address |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |

### OpenAI

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model to use |
| `OPENAI_MAX_TOKENS` | No | `512` | Max tokens for SQL generation |
| `OPENAI_TEMPERATURE` | No | `0` | Sampling temperature (0 = deterministic) |

### Query Engine

| Variable | Required | Default | Description |
|---|---|---|---|
| `QUERY_MODE` | No | `READ_ONLY` | `READ_ONLY` or `CRUD_ENABLED` |
| `QUERY_TIMEOUT_MS` | No | `5000` | Max query execution time in ms |
| `QUERY_MAX_ROWS` | No | `100` | Injected LIMIT if none specified (SELECT only) |
| `CACHE_TTL_SECONDS` | No | `3600` | Redis result cache TTL |
| `PENDING_WRITE_TTL_SECONDS` | No | `300` | Confirmation token TTL (seconds) |
| `SCHEMA_REFRESH_INTERVAL_MS` | No | `600000` | Schema re-introspection interval |
| `DB_SCHEMAS` | No | `public` | Comma-separated schemas to introspect |

### Cost Estimation

| Variable | Required | Default | Description |
|---|---|---|---|
| `QUERY_COST_THRESHOLD` | No | `10000` | Reject SELECT queries with EXPLAIN cost above this value |
| `SEQ_SCAN_ROW_THRESHOLD` | No | `100000` | Reject seq scans on tables with more estimated rows than this |

### Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `MAX_QUESTION_LENGTH` | No | `2000` | Max chars for user query input |
| `SENSITIVE_COLUMN_PATTERNS` | No | `password,token,...` | Columns hidden from LLM |

### Rate Limiting

| Variable | Required | Default | Description |
|---|---|---|---|
| `RATE_LIMIT_MAX` | No | `60` | Global max requests per window per IP/user |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |

Per-route limits (hardcoded, override global):

| Route | Limit |
|---|---|
| `POST /api/query` | 30/min |
| `POST /api/replay` | 10/min |
| `GET /api/history` | 60/min |
| `GET /api/schema/version` | 60/min |

### Database Pool

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_POOL_MAX` | No | `10` | PostgreSQL pool max connections |
| `DB_IDLE_TIMEOUT_MS` | No | `30000` | Pool idle timeout |
| `DB_CONNECTION_TIMEOUT_MS` | No | `5000` | Pool connection timeout |

*Or set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` individually.

---

## API Reference

### `POST /api/query`

Ask a natural language question or instruction.

**Rate limit:** 30/min

**Optional RBAC headers:**
- `X-User-Id: <id>` — user identity
- `X-User-Role: admin | analyst | readonly` — controls table access

#### Request Body

```json
{ "query": "<natural language>" }
```

#### READ_ONLY mode response

```json
{
  "query": "SELECT ...",
  "explanation": "Retrieves the 10 customers with the highest total order value.",
  "data": [{ "customer_id": 42, "total_value": "9850.00" }],
  "row_count": 10,
  "type": "READ",
  "cost_estimation": {
    "total_cost": 18.5,
    "has_seq_scan": false,
    "seq_scan_tables": [],
    "estimated_rows": 10,
    "plan_summary": "Index Scan ..."
  }
}
```

#### CRUD_ENABLED — INSERT response

```json
{
  "query": "INSERT INTO users ...",
  "explanation": "Inserts a new user record.",
  "data": [],
  "row_count": 1,
  "type": "WRITE",
  "affected_rows": 1
}
```

#### CRUD_ENABLED — UPDATE/DELETE response (two-step)

**Step 1** returns a dry-run preview:

```json
{
  "status": "AWAITING_CONFIRMATION",
  "type": "WRITE",
  "operation": "DELETE",
  "impact": {
    "affected_rows": 3,
    "preview": [{ "id": 1, "name": "Alice" }],
    "warning": "You are about to delete 3 rows. This cannot be undone."
  },
  "query": "DELETE FROM users WHERE name = 'Alice'",
  "explanation": "Deletes all user records named Alice.",
  "confirmation_token": "a3f2c1d4-...",
  "confirm_to_proceed": "POST { \"token\": \"...\" } to /api/query/confirm to execute"
}
```

**Step 2:** send token to `/api/query/confirm`.

---

### `POST /api/query/confirm`

Execute a pending UPDATE/DELETE by token.

```json
{ "token": "a3f2c1d4-..." }
```

---

### `GET /api/history`

Return query history (newest first, max 50).

**Rate limit:** 60/min

**Query params:**
- `mode=READ_ONLY|CRUD_ENABLED`
- `status=success|failure`
- `limit=<number>` (max 50)

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "nl_query": "Show all users",
      "generated_sql": "SELECT * FROM users LIMIT 100",
      "mode": "READ_ONLY",
      "type": "READ",
      "execution_time_ms": 42,
      "row_count": 10,
      "affected_rows": null,
      "status": "success",
      "error_code": null,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

---

### `POST /api/replay`

Re-run a previous NL query through the full pipeline by history ID. Does **not** reuse the previous SQL — a new query is generated, validated, and executed. Stores a new history entry.

**Rate limit:** 10/min

```json
{ "history_id": "<uuid>" }
```

**Response:** same shape as `/api/query`, with an extra `replayed_from` field.

---

### `GET /api/schema/version`

Returns the current schema hash and metadata.

**Rate limit:** 60/min

```json
{
  "hash": "a3f2c1d4...",
  "table_count": 8,
  "last_updated": "2024-01-01T10:00:00.000Z"
}
```

The `hash` is a full SHA-256 of all table+column+type combinations. Changes when the schema is modified (detected and logged as `SCHEMA_CHANGED`).

---

### `GET /api/metrics`

Aggregated query statistics computed from `query_history`.

```json
{
  "total_queries": 1000,
  "successful_queries": 950,
  "failed_queries": 50,
  "success_rate": 95.0,
  "avg_execution_time_ms": 45,
  "p95_execution_time_ms": 120,
  "total_read_queries": 800,
  "total_write_queries": 200,
  "queries_last_hour": 15,
  "queries_last_24h": 60,
  "error_breakdown": [
    { "error_code": "TIMEOUT", "count": 5 }
  ],
  "mode_breakdown": [
    { "mode": "READ_ONLY", "count": 800 }
  ],
  "computed_at": "2024-01-01T10:00:00.000Z"
}
```

---

### `POST /api/feedback`

Submit thumbs-up/down feedback for a query history entry.

User identity comes from `X-User-Id` header. One feedback per user per query.

```json
{
  "history_id": "<uuid>",
  "feedback": "up",
  "comment": "Great result!"
}
```

**Response** `201 Created`:

```json
{
  "id": "uuid",
  "history_id": "uuid",
  "user_id": "user-123",
  "feedback": "up",
  "comment": "Great result!",
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### `GET /api/feedback/stats`

Aggregated feedback statistics.

```json
{
  "total": 100,
  "up": 75,
  "down": 25,
  "up_percentage": 75.0,
  "top_rated": [{ "history_id": "uuid", "up_count": 10 }],
  "most_disliked": [{ "history_id": "uuid", "down_count": 5 }]
}
```

---

### `GET /health`

Liveness and readiness probe.

```json
{
  "status": "ok",
  "uptime": 124.3,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "services": { "database": "connected", "redis": "connected" }
}
```

Returns `200` when healthy, `503` when the database is unreachable.

---

### `POST /admin/refresh-schema`

Force a schema re-introspection. If the schema hash has changed, logs a `SCHEMA_CHANGED` event.

```json
{ "ok": true, "message": "Schema refreshed" }
```

---

## RBAC

When `X-User-Id` and `X-User-Role` headers are present on `POST /api/query`, role-based access is enforced.

| Role | SELECT | CRUD | Table restriction |
|---|---|---|---|
| `admin` | ✅ | ✅ | None — bypasses table check |
| `analyst` | ✅ | ❌ | Must have table in `allowed_tables` |
| `readonly` | ✅ | ❌ | Must have table in `allowed_tables` |

User permissions are stored in the `rbac_roles` table (see `src/migrations/002_rbac_roles.sql`).

**Errors:**

| `type` | HTTP | Cause |
|---|---|---|
| `USER_CONTEXT_MISSING` | 401 | Headers present but missing/invalid |
| `TABLE_ACCESS_DENIED` | 403 | User role not allowed on accessed table |
| `CRUD_NOT_ALLOWED` | 403 | Non-admin user attempted CRUD mode |

---

## Error Reference

| `type` | HTTP | Cause |
|---|---|---|
| `WRITE_NOT_ALLOWED` | 403 | Write attempted in READ_ONLY mode, or DDL (DROP/ALTER/TRUNCATE) |
| `MISSING_WHERE_CLAUSE` | 400 | UPDATE or DELETE has no WHERE clause |
| `SCHEMA_VIOLATION` | 400 | Unknown table/column (CRUD mode) |
| `SCHEMA_MISMATCH` | 400 | Unknown table/column (READ_ONLY mode) |
| `INVALID_SQL` | 400 | SQL could not be parsed |
| `AMBIGUOUS_QUERY` | 400 | Question can't be mapped to SQL |
| `VALIDATION_ERROR` | 400 | Body validation or prompt injection |
| `QUERY_TOO_EXPENSIVE` | 400 | EXPLAIN cost or row estimate exceeds threshold |
| `TABLE_ACCESS_DENIED` | 403 | RBAC: user not allowed to access table |
| `CRUD_NOT_ALLOWED` | 403 | RBAC: role cannot use CRUD mode |
| `USER_CONTEXT_MISSING` | 401 | RBAC headers missing or invalid |
| `HISTORY_NOT_FOUND` | 404 | history_id not found for replay or feedback |
| `FEEDBACK_ALREADY_SUBMITTED` | 400 | User already rated this query |
| `INVALID_FEEDBACK_VALUE` | 400 | Feedback must be 'up' or 'down'; comment too long |
| `TIMEOUT` | 504 | Query exceeded the time limit |
| `EXECUTION_ERROR` | 500 | PostgreSQL execution error |
| `AI_UNAVAILABLE` | 502 | OpenAI API unreachable |

**Rate limit error:**

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please wait before retrying.",
  "retry_after_seconds": 30
}
```

---

## Logging Events

All events are emitted via pino structured logging with `request_id` on every entry.

| Event | Description |
|---|---|
| `QUERY_RECEIVED` | NL query arrived at the handler |
| `SQL_GENERATED` | OpenAI returned SQL; includes `llm_latency_ms` |
| `VALIDATION_FAILED` | AST validation rejected the SQL |
| `CACHE_HIT` | Result served from Redis cache |
| `QUERY_EXECUTED` | DB execution complete; includes `db_execution_ms`, `row_count` |
| `SCHEMA_CHANGED` | Schema hash changed on refresh; includes `previous_hash` / `new_hash` |
| `RATE_LIMIT_HIT` | Request rejected by rate limiter (Fastify native) |
| `WRITE_CONFIRMED` | INSERT executed successfully |

---

## Architecture

```
POST /api/query  { query }
      │
      ▼
Per-route Rate Limiter (30/min)
      │
      ▼
RBAC check (if X-User-Id / X-User-Role headers present)
      │
      ▼
Redis Cache? (READ_ONLY SELECT only)
  HIT ──────────── save history ──▶ Response
  MISS
      │
      ▼
Schema Service (information_schema + Redis cache)
      │
      ▼
OpenAI: NL → SQL (QUERY_MODE from env)
      │
      ▼
node-sql-parser: AST validation
      │
      ▼
RBAC table access validation
      │
      ├── SELECT ──▶ EXPLAIN cost check ──▶ pg Pool ──▶ cache ──▶ save history ──▶ Response { type: READ, cost_estimation }
      │
      ├── INSERT ──▶ pg Pool ──▶ save history ──▶ Response { type: WRITE }
      │
      └── UPDATE | DELETE
              │
              ▼
         dry-run SELECT preview (LIMIT 10)
         generate confirmation_token → Redis (TTL)
              │
              ▼
         Response AWAITING_CONFIRMATION { impact, preview, confirmation_token }
```

---

## Database Migrations

| File | Description |
|---|---|
| `src/migrations/001_query_history.sql` | `query_history` table + indexes |
| `src/migrations/002_rbac_roles.sql` | `rbac_roles` table + index |
| `src/migrations/003_query_feedback.sql` | `query_feedback` table + unique constraint |

---

## Development

```bash
# Type check
npx tsc --noEmit

# Run tests
npm test

# Test with coverage
npm run test:coverage

# Development server (hot reload)
npm run dev
```
