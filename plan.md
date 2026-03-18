# Production-Grade Feature Extensions

## Goal
Extend the NL-to-SQL engine with 7 production-grade features: query history, schema versioning, per-route rate limiting, structured logging + metrics, RBAC, query cost estimation, and feedback loop.

## TODOs

- [ ] Feature 1: Query History + Replay — table, GET /api/history, POST /api/replay, pipeline integration
- [ ] Feature 2: Schema Versioning + Cache Invalidation — SHA-256 hash tracking, schema:version Redis key, SCHEMA_CHANGED log, GET /api/schema/version
- [ ] Feature 3: Per-route Rate Limiting — 30/10/60/60 per route via @fastify/rate-limit, updated error format
- [ ] Feature 4: Logging + Metrics — structured pino logs with latency tracking, GET /api/metrics from query_history
- [ ] Feature 5: RBAC — rbac_roles table, X-User-Id/X-User-Role headers, table access validation, CRUD restriction
- [ ] Feature 6: Query Cost Estimation — EXPLAIN pre-check, cost threshold, seq scan detection, cost_estimation in response
- [ ] Feature 7: Feedback Loop — query_feedback table, POST /api/feedback, GET /api/feedback/stats, one-per-user constraint

## Acceptance Criteria

- All endpoints documented in README.md
- Every new module has a co-located test file
- Migrations in src/migrations/
- New env vars in .env.example
- Zero TypeScript errors
- All tests pass

## Test Plan

- Unit tests for each new service (historyService, rbacService, costEstimator, feedbackService)
- Route-level integration tests for each new endpoint group
- Mock DB/Redis at boundaries — no real connections in unit tests
