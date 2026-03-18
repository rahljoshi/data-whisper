import Fastify from 'fastify';
import { metricsRoutes } from './metrics.route';
import type { Pool } from 'pg';

function mockPool(metricsRows: unknown, errorRows: unknown, modeRows: unknown): Pool {
  return {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [metricsRows] })
      .mockResolvedValueOnce({ rows: errorRows })
      .mockResolvedValueOnce({ rows: modeRows }),
  } as unknown as Pool;
}

describe('GET /api/metrics', () => {
  it('returns aggregated metrics from query_history', async () => {
    const pool = mockPool(
      {
        total_queries: '100',
        successful_queries: '90',
        failed_queries: '10',
        avg_execution_time_ms: '45.5',
        p95_execution_time_ms: '120.0',
        total_read_queries: '80',
        total_write_queries: '20',
        queries_last_hour: '15',
        queries_last_24h: '60',
      },
      [{ error_code: 'TIMEOUT', count: '5' }, { error_code: 'INVALID_SQL', count: '3' }],
      [{ mode: 'READ_ONLY', count: '80' }, { mode: 'CRUD_ENABLED', count: '20' }],
    );

    const app = Fastify({ logger: false });
    await app.register(metricsRoutes, { pool });

    const resp = await app.inject({ method: 'GET', url: '/api/metrics' });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{
      total_queries: number;
      successful_queries: number;
      success_rate: number;
      error_breakdown: { error_code: string; count: number }[];
      mode_breakdown: { mode: string; count: number }[];
      computed_at: string;
    }>();
    expect(body.total_queries).toBe(100);
    expect(body.successful_queries).toBe(90);
    expect(body.success_rate).toBe(90);
    expect(body.error_breakdown).toHaveLength(2);
    expect(body.error_breakdown[0]).toEqual({ error_code: 'TIMEOUT', count: 5 });
    expect(body.mode_breakdown).toHaveLength(2);
    expect(body.computed_at).toBeDefined();
  });

  it('returns zeros when query_history is empty', async () => {
    const pool = mockPool(
      {
        total_queries: '0',
        successful_queries: '0',
        failed_queries: '0',
        avg_execution_time_ms: null,
        p95_execution_time_ms: null,
        total_read_queries: '0',
        total_write_queries: '0',
        queries_last_hour: '0',
        queries_last_24h: '0',
      },
      [],
      [],
    );

    const app = Fastify({ logger: false });
    await app.register(metricsRoutes, { pool });

    const resp = await app.inject({ method: 'GET', url: '/api/metrics' });
    const body = resp.json<{ total_queries: number; success_rate: number; avg_execution_time_ms: number }>();
    expect(body.total_queries).toBe(0);
    expect(body.success_rate).toBe(0);
    expect(body.avg_execution_time_ms).toBe(0);
  });
});
