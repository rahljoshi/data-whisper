import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

interface MetricsRow {
  total_queries: string;
  successful_queries: string;
  failed_queries: string;
  avg_execution_time_ms: string | null;
  p95_execution_time_ms: string | null;
  total_read_queries: string;
  total_write_queries: string;
  queries_last_hour: string;
  queries_last_24h: string;
}

interface ErrorBreakdownRow {
  error_code: string;
  count: string;
}

interface ModeBreakdownRow {
  mode: string;
  count: string;
}

export async function metricsRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool },
): Promise<void> {
  const { pool } = options;

  /**
   * GET /api/metrics
   * Computes aggregated metrics from query_history.
   */
  fastify.get(
    '/api/metrics',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [metricsResult, errorBreakdownResult, modeBreakdownResult] = await Promise.all([
        pool.query<MetricsRow>(`
          SELECT
            COUNT(*)::text AS total_queries,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::text AS successful_queries,
            SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END)::text AS failed_queries,
            AVG(execution_time_ms)::text AS avg_execution_time_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms)::text AS p95_execution_time_ms,
            SUM(CASE WHEN type = 'READ' THEN 1 ELSE 0 END)::text AS total_read_queries,
            SUM(CASE WHEN type = 'WRITE' THEN 1 ELSE 0 END)::text AS total_write_queries,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END)::text AS queries_last_hour,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END)::text AS queries_last_24h
          FROM query_history
        `),
        pool.query<ErrorBreakdownRow>(`
          SELECT error_code, COUNT(*)::text AS count
          FROM query_history
          WHERE status = 'failure' AND error_code IS NOT NULL
          GROUP BY error_code
          ORDER BY count DESC
          LIMIT 10
        `),
        pool.query<ModeBreakdownRow>(`
          SELECT mode, COUNT(*)::text AS count
          FROM query_history
          GROUP BY mode
        `),
      ]);

      const m = metricsResult.rows[0];

      return reply.send({
        total_queries: parseInt(m.total_queries ?? '0', 10),
        successful_queries: parseInt(m.successful_queries ?? '0', 10),
        failed_queries: parseInt(m.failed_queries ?? '0', 10),
        success_rate:
          parseInt(m.total_queries ?? '0', 10) > 0
            ? Math.round(
                (parseInt(m.successful_queries ?? '0', 10) /
                  parseInt(m.total_queries ?? '0', 10)) *
                  10000,
              ) / 100
            : 0,
        avg_execution_time_ms: m.avg_execution_time_ms
          ? Math.round(parseFloat(m.avg_execution_time_ms))
          : 0,
        p95_execution_time_ms: m.p95_execution_time_ms
          ? Math.round(parseFloat(m.p95_execution_time_ms))
          : 0,
        total_read_queries: parseInt(m.total_read_queries ?? '0', 10),
        total_write_queries: parseInt(m.total_write_queries ?? '0', 10),
        queries_last_hour: parseInt(m.queries_last_hour ?? '0', 10),
        queries_last_24h: parseInt(m.queries_last_24h ?? '0', 10),
        error_breakdown: errorBreakdownResult.rows.map((r) => ({
          error_code: r.error_code,
          count: parseInt(r.count, 10),
        })),
        mode_breakdown: modeBreakdownResult.rows.map((r) => ({
          mode: r.mode,
          count: parseInt(r.count, 10),
        })),
        computed_at: new Date().toISOString(),
      });
    },
  );
}
