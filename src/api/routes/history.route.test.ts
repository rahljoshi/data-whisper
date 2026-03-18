import Fastify from 'fastify';
import { historyRoutes } from './history.route';
import * as historyService from '../../history/historyService';
import * as aiService from '../../ai/ai.service';
import * as sqlValidator from '../../validation/sqlValidator';
import * as queryExecutor from '../../execution/queryExecutor';
import * as schemaService from '../../schema/schemaService';
import * as cacheService from '../../cache/cacheService';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

jest.mock('../../history/historyService');
jest.mock('../../ai/ai.service');
jest.mock('../../validation/sqlValidator');
jest.mock('../../execution/queryExecutor');
jest.mock('../../schema/schemaService');
jest.mock('../../cache/cacheService');
jest.mock('../../config', () => ({
  config: {
    query: { mode: 'READ_ONLY', cacheTtlSeconds: 3600, pendingWriteTtlSeconds: 300 },
    llm: { provider: 'anthropic' },
    security: { maxQuestionLength: 2000, sensitiveColumnPatterns: [] },
  },
}));

const mockPool = {} as Pool;
const mockRedis = null as Redis | null;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(historyRoutes, { pool: mockPool, redis: mockRedis });
  return app;
}

describe('GET /api/history', () => {
  it('returns history entries with count', async () => {
    const entries = [
      {
        id: 'uuid-1',
        nl_query: 'Show users',
        generated_sql: 'SELECT * FROM users LIMIT 100',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 42,
        row_count: 5,
        affected_rows: null,
        status: 'success',
        error_code: null,
        created_at: '2024-01-01T00:00:00Z',
      },
    ];
    jest.mocked(historyService.getHistory).mockResolvedValue(entries as ReturnType<typeof historyService.getHistory> extends Promise<infer T> ? T : never);

    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: '/api/history' });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ data: unknown[]; count: number }>();
    expect(body.count).toBe(1);
    expect(body.data).toHaveLength(1);
  });

  it('passes mode and status query filters', async () => {
    jest.mocked(historyService.getHistory).mockResolvedValue([]);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/history?mode=READ_ONLY&status=success&limit=10' });

    expect(historyService.getHistory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ mode: 'READ_ONLY', status: 'success', limit: 10 }),
    );
  });

  it('returns 400 for invalid mode filter', async () => {
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: '/api/history?mode=INVALID' });
    expect(resp.statusCode).toBe(400);
  });
});

describe('POST /api/replay', () => {
  const mockHistory = {
    id: 'hist-uuid',
    nl_query: 'Show all orders',
    generated_sql: 'SELECT * FROM orders LIMIT 100',
    mode: 'READ_ONLY' as const,
    type: 'READ' as const,
    execution_time_ms: 50,
    row_count: 3,
    affected_rows: null,
    status: 'success' as const,
    error_code: null,
    created_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.mocked(historyService.getHistoryById).mockResolvedValue(mockHistory);
    jest.mocked(historyService.insertHistory).mockResolvedValue('new-uuid');
    jest.mocked(schemaService.getSchemaVersion).mockReturnValue('v1');
    jest.mocked(schemaService.getSchema).mockReturnValue(new Map());
    jest.mocked(cacheService.getCachedResult).mockResolvedValue(null);
    jest.mocked(cacheService.setCachedResult).mockResolvedValue();
    jest.mocked(aiService.generateSQL).mockResolvedValue({ sql: 'SELECT * FROM orders LIMIT 100', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    jest.mocked(sqlValidator.validateSql).mockReturnValue({
      sql: 'SELECT * FROM orders LIMIT 100',
      statementType: 'SELECT',
    });
    jest.mocked(queryExecutor.executeQuery).mockResolvedValue({ rows: [], rowCount: 0 });
    jest.mocked(aiService.explainSQL).mockResolvedValue({ explanation: 'Shows all orders.', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
  });

  it('replays a query through the full pipeline and returns result', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/replay',
      payload: { history_id: 'hist-uuid' },
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ replayed_from: string; type: string }>();
    expect(body.replayed_from).toBe('hist-uuid');
    expect(body.type).toBe('READ');
    expect(aiService.generateSQL).toHaveBeenCalled();
  });

  it('stores a new history entry for the replay', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/replay',
      payload: { history_id: 'hist-uuid' },
    });

    expect(historyService.insertHistory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ nl_query: 'Show all orders', status: 'success' }),
    );
  });

  it('returns 404 when history_id is not found', async () => {
    jest.mocked(historyService.getHistoryById).mockResolvedValue(null);

    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/replay',
      payload: { history_id: 'nonexistent' },
    });

    expect(resp.statusCode).toBe(404);
  });

  it('returns 400 for missing history_id', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/replay',
      payload: {},
    });
    expect(resp.statusCode).toBe(400);
  });

  it('saves failure history when SQL generation fails', async () => {
    const { AppError, ErrorType } = await import('../../types/errors');
    jest.mocked(aiService.generateSQL).mockRejectedValue(
      new AppError(ErrorType.AI_UNAVAILABLE, 'AI provider down'),
    );

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/replay',
      payload: { history_id: 'hist-uuid' },
    });

    expect(historyService.insertHistory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ status: 'failure', error_code: 'AI_UNAVAILABLE' }),
    );
  });
});
