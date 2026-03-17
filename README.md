# data-whisper

A production-grade Natural Language to SQL engine. Send a plain-English question, get back the SQL query, an explanation of what it does, and the results — all validated at the AST level before touching your database.

Supports **READ_ONLY** mode (SELECT-only, safe for analytics) and **CRUD_ENABLED** mode (INSERT/UPDATE/DELETE with mandatory WHERE enforcement and a write-confirmation flow for destructive operations).

---

## Features

- **NL → SQL via OpenAI** — mode-aware system prompts enforce SELECT-only or full CRUD output
- **AST-level security** — `node-sql-parser` blocks disallowed statements before execution; no regex
- **Read vs CRUD mode** — `READ_ONLY` default; `CRUD_ENABLED` unlocks writes with safety guardrails
- **Write confirmation flow** — UPDATE/DELETE require a second request with `confirm_write: true`; first request returns a dry-run preview with affected row count and sample data
- **WHERE clause enforcement** — UPDATE/DELETE without WHERE are rejected at the AST level
- **Schema whitelist validation** — LLM-hallucinated tables and columns are rejected
- **Redis caching** — identical SELECT questions return cached results instantly (1-hour TTL)
- **5-second query timeout** — runaway queries are killed automatically
- **Graceful Redis degradation** — cache failures never bring down the service
- **Structured error responses** — every error includes a machine-readable `type` field
- **Rate limiting** — 60 requests/minute per IP by default

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

### 3. Load mock data (optional but recommended)

A full seed file is provided with 8 tables and realistic e-commerce data:

```bash
psql -U <user> -d <database> -f database/seed.sql
```

This creates: `departments`, `employees`, `categories`, `products`, `customers`, `orders`, `order_items`, `reviews` — with ~200 rows across all tables.

See [`database/example-queries.md`](database/example-queries.md) for 40+ ready-to-use natural language test questions.

### 4. Build

```bash
npm run build
```

### 5. Start

```bash
# Production
npm start

# Development (hot reload)
npm run dev
```

The server starts on `http://localhost:3000` by default.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key |
| `DATABASE_URL` | **Yes*** | — | Full PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `PORT` | No | `3000` | HTTP port |
| `HOST` | No | `0.0.0.0` | HTTP bind address |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model to use |
| `OPENAI_MAX_TOKENS` | No | `512` | Max tokens for SQL generation |
| `QUERY_TIMEOUT_MS` | No | `5000` | Max query execution time in ms |
| `QUERY_MAX_ROWS` | No | `100` | Injected LIMIT if none specified (SELECT only) |
| `CACHE_TTL_SECONDS` | No | `3600` | Redis result cache TTL |
| `SCHEMA_REFRESH_INTERVAL_MS` | No | `600000` | Schema re-introspection interval |
| `MAX_QUESTION_LENGTH` | No | `2000` | Max chars for user query input |
| `SENSITIVE_COLUMN_PATTERNS` | No | `password,token,...` | Columns hidden from LLM |
| `RATE_LIMIT_MAX` | No | `60` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `DB_SCHEMAS` | No | `public` | Comma-separated schemas to introspect |
| `DB_POOL_MAX` | No | `10` | PostgreSQL pool max connections |

*Or set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` individually.

---

## API Reference

### `POST /api/query`

Ask a natural language question about your database. Supports both read and write operations via the `mode` field.

#### Request Body

```json
{
  "query": "<natural language>",
  "mode": "READ_ONLY | CRUD_ENABLED",
  "confirm_write": true
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | **Yes** | — | Natural language question or instruction |
| `mode` | string | No | `READ_ONLY` | `READ_ONLY` or `CRUD_ENABLED` |
| `confirm_write` | boolean | No | `false` | Set to `true` to execute a pending UPDATE/DELETE |

---

#### READ_ONLY mode (default)

Only SELECT queries are generated. Any write attempt is blocked.

**Request**

```json
{
  "query": "Show me the top 10 customers by total order value"
}
```

**Success Response** `200 OK`

```json
{
  "query": "SELECT customer_id, SUM(total) AS total_value\nFROM orders\nGROUP BY customer_id\nORDER BY total_value DESC\nLIMIT 10",
  "explanation": "Retrieves the 10 customers with the highest total order value.",
  "data": [
    { "customer_id": 42, "total_value": "9850.00" }
  ],
  "row_count": 10,
  "type": "READ"
}
```

---

#### CRUD_ENABLED — INSERT

INSERT executes immediately. No confirmation step required.

**Request**

```json
{
  "query": "Add a new user named Alice with email alice@example.com",
  "mode": "CRUD_ENABLED"
}
```

**Success Response** `200 OK`

```json
{
  "query": "INSERT INTO users (name, email)\nVALUES ('Alice', 'alice@example.com')",
  "explanation": "Inserts a new user record for Alice.",
  "data": [],
  "row_count": 1,
  "type": "WRITE",
  "affected_rows": 1
}
```

---

#### CRUD_ENABLED — UPDATE / DELETE (confirmation flow)

**Step 1 — Send without `confirm_write` (or with `confirm_write: false`)**

```json
{
  "query": "Delete all users named Rahul",
  "mode": "CRUD_ENABLED"
}
```

**Response** `200 OK` — dry-run preview, nothing executed

```json
{
  "status": "AWAITING_CONFIRMATION",
  "type": "WRITE",
  "operation": "DELETE",
  "impact": {
    "affected_rows": 3,
    "preview": [
      { "id": 1, "name": "Rahul", "email": "rahul1@example.com" },
      { "id": 2, "name": "Rahul", "email": "rahul2@example.com" },
      { "id": 3, "name": "Rahul", "email": "rahul3@example.com" }
    ],
    "warning": "You are about to delete 3 rows. This cannot be undone."
  },
  "query": "DELETE FROM users\nWHERE name = 'Rahul'",
  "explanation": "Deletes all user records where the name is Rahul.",
  "confirm_to_proceed": "Resend with confirm_write: true to execute"
}
```

**Step 2 — Resend with `confirm_write: true` to execute**

```json
{
  "query": "Delete all users named Rahul",
  "mode": "CRUD_ENABLED",
  "confirm_write": true
}
```

**Response** `200 OK`

```json
{
  "query": "DELETE FROM users\nWHERE name = 'Rahul'",
  "explanation": "Deletes all user records where the name is Rahul.",
  "data": [],
  "row_count": 3,
  "type": "WRITE",
  "affected_rows": 3
}
```

---

#### Error Response `400 / 403 / 500 / 502 / 504`

```json
{
  "error": {
    "type": "WRITE_NOT_ALLOWED",
    "message": "Statement type \"DROP\" is not allowed"
  }
}
```

**Error Types**

| `type` | HTTP | When |
|---|---|---|
| `WRITE_NOT_ALLOWED` | 403 | Write attempted in READ_ONLY mode, or DDL (DROP/ALTER/TRUNCATE) in any mode |
| `MISSING_WHERE_CLAUSE` | 400 | UPDATE or DELETE has no WHERE clause |
| `SCHEMA_VIOLATION` | 400 | Table or column not in schema (CRUD mode) |
| `SCHEMA_MISMATCH` | 400 | Table or column not in schema (READ_ONLY mode) |
| `INVALID_SQL` | 400 | SQL could not be parsed |
| `AMBIGUOUS_QUERY` | 400 | Question can't be mapped to a SQL query |
| `VALIDATION_ERROR` | 400 | Request body failed validation or prompt injection detected |
| `TIMEOUT` | 504 | Query exceeded the time limit |
| `EXECUTION_ERROR` | 500 | PostgreSQL error during execution |
| `AI_UNAVAILABLE` | 502 | OpenAI API is unreachable |

---

### `GET /health`

Liveness and readiness probe.

```json
{
  "status": "ok",
  "uptime": 124.3,
  "timestamp": "2024-11-01T12:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

Returns `200` when healthy, `503` when the database is unreachable.

---

### `POST /admin/refresh-schema`

Force a schema re-introspection without restarting the server. Useful after migrations.

```json
{ "ok": true, "message": "Schema refreshed" }
```

---

## Architecture

```
POST /api/query  { query, mode, confirm_write }
      │
      ▼
Rate Limiter
      │
      ▼
Redis Cache? (READ_ONLY SELECT only) ── HIT ────────────▶ Response
      │
     MISS
      │
      ▼
Schema Service (information_schema introspection)
      │
      ▼
OpenAI: NL → SQL  (mode-aware system prompt)
  READ_ONLY:    SELECT only
  CRUD_ENABLED: SELECT / INSERT / UPDATE / DELETE
      │
      ▼
node-sql-parser: AST validation (mode-aware)
  READ_ONLY:    reject non-SELECT → WRITE_NOT_ALLOWED
  CRUD_ENABLED: reject DDL → WRITE_NOT_ALLOWED
                reject UPDATE/DELETE without WHERE → MISSING_WHERE_CLAUSE
                reject unknown table/column → SCHEMA_VIOLATION
  SELECT:       inject LIMIT 100 if missing
      │
      ├── statementType = SELECT ──────────────────────────▶ pg Pool → explain → cache → Response { type: READ }
      │
      ├── statementType = INSERT ──────────────────────────▶ pg Pool → explain → Response { type: WRITE, affected_rows }
      │
      └── statementType = UPDATE | DELETE
              │
              ├── confirm_write != true ──▶ dry-run SELECT preview (LIMIT 10)
              │                            └─▶ Response AWAITING_CONFIRMATION { impact, preview, warning }
              │
              └── confirm_write = true ───▶ pg Pool → explain → Response { type: WRITE, affected_rows }
```

---

## Security

- **No raw LLM execution** — SQL is always parsed and validated before reaching the database
- **AST-level blocking** — statement type is checked structurally, never with regex
- **Table and column whitelist** — schema derived from live `information_schema`
- **WHERE enforcement** — UPDATE/DELETE without WHERE are rejected at the AST level in CRUD mode
- **Write confirmation gate** — destructive operations require an explicit second request
- **Prompt injection prevention** — user input is sanitized, length-capped, and isolated in the `user` role message
- **Sensitive column suppression** — columns matching `password`, `token`, `secret`, etc. are never sent to OpenAI
- **Rate limiting** — `@fastify/rate-limit` enforced at the HTTP layer

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
