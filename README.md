# data-whisper

A production-grade Natural Language to SQL engine. Send a plain-English question, get back the SQL query, an explanation of what it does, and the results — all validated at the AST level before touching your database.

---

## Features

- **NL → SQL via OpenAI** — strict system prompts enforce SELECT-only output
- **AST-level security** — `node-sql-parser` blocks all non-SELECT statements before execution
- **Schema whitelist validation** — LLM-hallucinated tables and columns are rejected
- **Redis caching** — identical questions return cached results instantly (1-hour TTL)
- **5-second query timeout** — runaway queries are killed automatically
- **Graceful Redis degradation** — cache failures never bring down the service
- **Structured error responses** — every error includes a machine-readable `type` field
- **Rate limiting** — 60 requests/minute per IP by default

---

## Stack

| Layer | Technology |
|---|---|
| HTTP Framework | Fastify 4 |
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

### 3. Build

```bash
npm run build
```

### 4. Start

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
| `QUERY_MAX_ROWS` | No | `100` | Injected LIMIT if none specified |
| `CACHE_TTL_SECONDS` | No | `3600` | Redis result cache TTL |
| `SCHEMA_REFRESH_INTERVAL_MS` | No | `600000` | Schema re-introspection interval |
| `MAX_QUESTION_LENGTH` | No | `2000` | Max chars for user question input |
| `SENSITIVE_COLUMN_PATTERNS` | No | `password,token,...` | Columns hidden from LLM |
| `RATE_LIMIT_MAX` | No | `60` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `DB_SCHEMAS` | No | `public` | Comma-separated schemas to introspect |
| `DB_POOL_MAX` | No | `10` | PostgreSQL pool max connections |

*Or set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` individually.

---

## API Reference

### `POST /api/query`

Ask a natural language question about your database.

**Request**

```json
{
  "question": "Show me the top 10 customers by total order value"
}
```

**Success Response** `200 OK`

```json
{
  "query": "SELECT customer_id, SUM(total) AS total_value FROM orders GROUP BY customer_id ORDER BY total_value DESC LIMIT 10",
  "explanation": "Retrieves the 10 customers with the highest total order value by summing all orders per customer.",
  "data": [
    { "customer_id": 42, "total_value": "9850.00" },
    ...
  ],
  "row_count": 10
}
```

**Error Response** `400 / 500 / 502 / 504`

```json
{
  "error": {
    "type": "SCHEMA_MISMATCH",
    "message": "Table \"invoices\" does not exist in the database schema"
  }
}
```

**Error Types**

| `type` | HTTP | Meaning |
|---|---|---|
| `INVALID_SQL` | 400 | LLM produced a non-SELECT statement |
| `SCHEMA_MISMATCH` | 400 | LLM referenced a table/column not in schema |
| `AMBIGUOUS_QUERY` | 400 | Question can't be mapped to a SQL query |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `TIMEOUT` | 504 | Query exceeded 5-second limit |
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
POST /api/query
      │
      ▼
Redis Cache? ──── HIT ──────────────────────────────────▶ Response
      │
     MISS
      │
      ▼
Schema Service (information_schema introspection)
      │
      ▼
OpenAI: NL → SQL  (strict system prompt — SELECT only)
      │
      ▼
node-sql-parser: AST validation
  ├── Reject non-SELECT statements
  ├── Reject unknown tables / columns
  └── Inject LIMIT 100 if missing
      │
      ▼
pg Pool: Execute with 5s timeout
      │
      ▼
OpenAI: SQL → Plain English explanation
      │
      ▼
Redis: Cache result (TTL 1h)
      │
      ▼
Response: { query, explanation, data, row_count }
```

---

## Security

- **No raw LLM execution** — SQL is always parsed and validated before reaching the database
- **AST-level blocking** — statement type is checked structurally, not with regex
- **Table and column whitelist** — schema derived from live `information_schema`
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

# Lint
npm run lint
```
