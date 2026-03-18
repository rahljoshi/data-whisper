# Multi-Provider LLM Support

## Goal
Refactor the AI service layer so the system works with any LLM provider (Anthropic, OpenAI, Gemini) without changing any other part of the codebase. Provider is selectable per-request with an env-variable default.

## TODOs

- [ ] TODO 1: Create `src/ai/provider.interface.ts` — `LLMProvider` interface + shared prompt constants
- [ ] TODO 2: Create `src/ai/providers/openai.provider.ts` + `openai.provider.test.ts`
- [ ] TODO 3: Create `src/ai/providers/anthropic.provider.ts` + `anthropic.provider.test.ts`
- [ ] TODO 4: Create `src/ai/providers/gemini.provider.ts` + `gemini.provider.test.ts`
- [ ] TODO 5: Create `src/ai/ai.service.ts` + `ai.service.test.ts` — provider registry, selection logic
- [ ] TODO 6: Update `src/config.ts` — LLM_PROVIDER, per-provider API keys + models, startup validation
- [ ] TODO 7: Update `src/types/api.ts` — add `provider` to `QueryRequest`, add `provider`+`model` to `QueryResponse`
- [ ] TODO 8: Update `src/cache/cacheService.ts` — include provider name in cache key
- [x] TODO 9: Update `src/api/routes/query.route.ts` — use ai.service, log provider+model, include in response; delete old sqlGenerator/sqlExplainer
- [ ] TODO 10: Update `.env.example` + `README.md`
- [ ] TODO 11: End-of-plan cleanup pass

## Acceptance Criteria

- [ ] Adding a new provider requires only one new file in `providers/` + entry in the provider map — nothing else changes
- [ ] Each provider handles its own SDK, auth, and error mapping
- [ ] All provider errors normalize to `AI_UNAVAILABLE` or `AMBIGUOUS_QUERY` — no SDK-specific errors leak
- [ ] Selected provider's API key missing → error at startup (not at request time)
- [ ] `SQL_GENERATED` log event includes `provider` and `model`
- [ ] Response body includes `provider` and `model` fields
- [ ] Cache keys include provider name — same NL query via different providers caches separately
- [ ] Zero TypeScript errors
- [ ] All tests pass

## Test Plan

- Unit tests per provider (mocked SDK, no real API calls)
- `ai.service.test.ts` — provider selection, fallback to default, unknown provider error
- `cacheService.test.ts` — provider-namespaced cache keys
- `query.route.test.ts` — updated to use ai.service mock, verify provider/model in response
