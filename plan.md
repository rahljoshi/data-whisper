# Production-Grade Feature Extensions

## Goal
Extend the NL-to-SQL engine with 7 production-grade features: query history, schema versioning, per-route rate limiting, structured logging + metrics, RBAC, query cost estimation, and feedback loop.

## TODOs

- [x] Feature 1: Query History + Replay — table, GET /api/history, POST /api/replay, pipeline integration
- [x] Feature 2: Schema Versioning + Cache Invalidation — SHA-256 hash tracking, schema:version Redis key, SCHEMA_CHANGED log, GET /api/schema/version
- [x] Feature 3: Per-route Rate Limiting — 30/10/60/60 per route via @fastify/rate-limit, updated error format
- [x] Feature 4: Logging + Metrics — structured pino logs with latency tracking, GET /api/metrics from query_history
- [x] Feature 5: RBAC — rbac_roles table, X-User-Id/X-User-Role headers, table access validation, CRUD restriction
- [x] Feature 6: Query Cost Estimation — EXPLAIN pre-check, cost threshold, seq scan detection, cost_estimation in response
- [x] Feature 7: Feedback Loop — query_feedback table, POST /api/feedback, GET /api/feedback/stats, one-per-user constraint

## Acceptance Criteria

- [x] All endpoints documented in README.md
- [x] Every new module has a co-located test file
- [x] Migrations in src/migrations/
- [x] New env vars in .env.example
- [x] Zero TypeScript errors
- [x] All tests pass (172/172)

## Test Plan

- Unit tests for each new service (historyService, rbacService, costEstimator, feedbackService)
- Route-level integration tests for each new endpoint group
- Mock DB/Redis at boundaries — no real connections in unit tests
