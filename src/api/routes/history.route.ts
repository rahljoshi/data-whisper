import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { getHistory, getHistoryById } from '../../history/historyService';
import { generateSql } from '../../ai/sqlGenerator';
import { validateSql } from '../../validation/sqlValidator';
import { formatSql } from '../../utils/sqlFormatter';
import { executeQuery } from '../../execution/queryExecutor';
import { explainSql } from '../../ai/sqlExplainer';
import { getSchema, getSchemaVersion } from '../../schema/schemaService';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { insertHistory } from '../../history/historyService';
import { AppError, ErrorType } from '../../types/errors';
import type { QueryMode } from '../../types/api';
import type { Redis } from 'ioredis';
import { config } from '../../config';

interface ReplayBody {
  history_id: string;
}

interface HistoryQuery {
  mode?: string;
  status?: string;
  limit?: string;
}

const historyQuerySchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['READ_ONLY', 'CRUD_ENABLED'] },
    status: { type: 'string', enum: ['success', 'failure'] },
    limit: { type: 'string' },
  },
  additionalProperties: false,
};

const replayBodySchema = {
  type: 'object',
  required: ['history_id'],
  properties: {
    history_id: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

export async function historyRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool; redis: Redis | null },
): Promise<void> {
  const { pool, redis } = options;

  /**
   * GET /api/history
   * Returns the last 50 queries (newest first). Supports ?mode=, ?status=, ?limit=
   */
  fastify.get<{ Querystring: HistoryQuery }>(
    '/api/history',
    {
      schema: { querystring: historyQuerySchema },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest<{ Querystring: HistoryQuery }>, reply: FastifyReply) => {
      const { mode, status, limit } = request.query;

      const parsedLimit = limit ? parseInt(limit, 10) : undefined;

      const entries = await getHistory(pool, {
        mode: mode as QueryMode | undefined,
        status: status as 'success' | 'failure' | undefined,
        limit: parsedLimit,
      });

      return reply.send({ data: entries, count: entries.length });
    },
  );

  /**
   * POST /api/replay
   * Re-runs a previous NL query through the full pipeline (does not reuse SQL).
   * Stores the result as a new history entry.
   */
  fastify.post<{ Body: ReplayBody }>(
    '/api/replay',
    {
      schema: { body: replayBodySchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest<{ Body: ReplayBody }>, reply: FastifyReply) => {
      const { history_id } = request.body;

      const original = await getHistoryById(pool, history_id);
      if (!original) {
        throw new AppError(ErrorType.HISTORY_NOT_FOUND, `History entry '${history_id}' not found.`);
      }

      const { nl_query, mode } = original;
      const startMs = Date.now();

      const schemaVersion = getSchemaVersion();

      // Cache lookup for READ queries
      const replayProvider = config.llm.provider;
      if (mode === 'READ_ONLY' && redis) {
        const cached = await getCachedResult(redis, nl_query, schemaVersion, replayProvider);
        if (cached) {
          request.log.info({ event: 'CACHE_HIT', history_id }, 'Replay served from cache');
          await insertHistory(pool, {
            nl_query,
            generated_sql: cached.query,
            mode,
            type: 'READ',
            execution_time_ms: Date.now() - startMs,
            row_count: cached.row_count,
            status: 'success',
          });
          return reply.send({ ...cached, replayed_from: history_id });
        }
      }

      const schema = getSchema();

      let generatedSql: string;
      try {
        generatedSql = await generateSql(nl_query, schema, mode as QueryMode);
      } catch (err) {
        const errorCode = err instanceof AppError ? err.type : ErrorType.AI_UNAVAILABLE;
        await insertHistory(pool, {
          nl_query,
          generated_sql: '',
          mode: mode as QueryMode,
          type: 'READ',
          execution_time_ms: Date.now() - startMs,
          status: 'failure',
          error_code: errorCode,
        });
        throw err;
      }

      let validatedSql: string;
      let statementType: string;

      try {
        const validated = validateSql(generatedSql, schema, mode as QueryMode);
        validatedSql = validated.sql;
        statementType = validated.statementType;
      } catch (err) {
        const errorCode = err instanceof AppError ? err.type : ErrorType.INVALID_SQL;
        await insertHistory(pool, {
          nl_query,
          generated_sql: generatedSql,
          mode: mode as QueryMode,
          type: 'READ',
          execution_time_ms: Date.now() - startMs,
          status: 'failure',
          error_code: errorCode,
        });
        throw err;
      }

      const formattedSql = formatSql(validatedSql);
      const queryType = statementType === 'SELECT' ? 'READ' : 'WRITE';

      try {
        const { rows, rowCount } = await executeQuery(validatedSql);
        const explanation = await explainSql(validatedSql);

        const executionTimeMs = Date.now() - startMs;

        await insertHistory(pool, {
          nl_query,
          generated_sql: validatedSql,
          mode: mode as QueryMode,
          type: queryType,
          execution_time_ms: executionTimeMs,
          row_count: queryType === 'READ' ? rowCount : null,
          affected_rows: queryType === 'WRITE' ? rowCount : null,
          status: 'success',
        });

        const result = {
          query: formattedSql,
          explanation,
          data: rows,
          row_count: rowCount,
          type: queryType,
          replayed_from: history_id,
        };

        if (mode === 'READ_ONLY' && statementType === 'SELECT' && redis) {
          await setCachedResult(redis, nl_query, schemaVersion, replayProvider, {
            query: formattedSql,
            explanation,
            data: rows,
            row_count: rowCount,
            type: 'READ',
          });
        }

        return reply.send(result);
      } catch (err) {
        const errorCode = err instanceof AppError ? err.type : ErrorType.EXECUTION_ERROR;
        await insertHistory(pool, {
          nl_query,
          generated_sql: validatedSql,
          mode: mode as QueryMode,
          type: queryType,
          execution_time_ms: Date.now() - startMs,
          status: 'failure',
          error_code: errorCode,
        });
        throw err;
      }
    },
  );
}
