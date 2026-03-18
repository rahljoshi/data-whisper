import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateSql } from '../../ai/sqlGenerator';
import { explainSql } from '../../ai/sqlExplainer';
import { validateSql, buildPreviewSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion, refreshSchemaFromDb } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import { storePendingWrite, getPendingWrite } from '../../cache/pendingWriteStore';
import { insertHistory } from '../../history/historyService';
import { extractUserContext, loadUserRole, validateAccess, extractTablesFromSql } from '../../rbac/rbacService';
import { estimateQueryCost, assertCostAcceptable } from '../../execution/costEstimator';
import type { QueryRequest, ConfirmWriteRequest, QueryResponse, WriteConfirmationResponse } from '../../types/api';
import { AppError, ErrorType } from '../../types/errors';
import { getPool } from '../../execution/queryExecutor';
import { config } from '../../config';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

// ── JSON schemas ──────────────────────────────────────────────────────────────

const queryBodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
    },
  },
  additionalProperties: false,
};

const confirmBodySchema = {
  type: 'object',
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

const queryResponseSchema = {
  200: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      query: { type: 'string' },
      explanation: { type: 'string' },
      data: { type: 'array' },
      row_count: { type: 'integer' },
      type: { type: 'string' },
      affected_rows: { type: 'integer' },
      operation: { type: 'string' },
      confirmation_token: { type: 'string' },
      confirm_to_proceed: { type: 'string' },
      impact: {
        type: 'object',
        properties: {
          affected_rows: { type: 'integer' },
          preview: { type: 'array', items: { type: 'object', additionalProperties: true } },
          warning: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  },
  '4xx': {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function queryRoutes(
  fastify: FastifyInstance,
  options: { redis: Redis | null; pool: Pool },
): Promise<void> {
  const { redis, pool } = options;

  /**
   * POST /api/query
   *
   * Accepts { query } — a natural language instruction.
   * The operating mode (READ_ONLY / CRUD_ENABLED) is determined entirely by the
   * QUERY_MODE environment variable, not by the caller.
   *
   * For UPDATE / DELETE in CRUD_ENABLED mode, a dry-run preview is returned
   * along with a `confirmation_token`. The write is only executed when the
   * caller sends that token to POST /api/query/confirm.
   */
  fastify.post<{ Body: QueryRequest }>(
    '/api/query',
    {
      schema: {
        body: queryBodySchema,
        response: queryResponseSchema,
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest<{ Body: QueryRequest }>, reply: FastifyReply) => {
      const { query } = request.body;
      const mode = config.query.mode;
      const startMs = Date.now();

      request.log.info({ event: 'QUERY_RECEIVED', mode }, 'Query received');

      // 1. Cache lookup — SELECT / READ_ONLY only
      const schemaVersion = getSchemaVersion();
      if (mode === 'READ_ONLY' && redis) {
        const cached = await getCachedResult(redis, query, schemaVersion);
        if (cached) {
          request.log.info({ event: 'CACHE_HIT', cache_hit: true }, 'Serving result from cache');
          await insertHistory(pool, {
            nl_query: query,
            generated_sql: cached.query,
            mode,
            type: 'READ',
            execution_time_ms: Date.now() - startMs,
            row_count: cached.row_count,
            status: 'success',
          });
          return reply.send(cached);
        }
      }

      // 2. Get schema
      const schema = getSchema();

      // 3. Generate SQL (mode is service-level)
      const llmStart = Date.now();
      request.log.info({ event: 'QUERY_RECEIVED', mode }, 'Generating SQL from query');
      let rawSql: string;
      try {
        rawSql = await generateSql(query, schema, mode);
      } catch (err) {
        const errorCode = err instanceof AppError ? err.type : ErrorType.AI_UNAVAILABLE;
        await insertHistory(pool, {
          nl_query: query,
          generated_sql: '',
          mode,
          type: 'READ',
          execution_time_ms: Date.now() - startMs,
          status: 'failure',
          error_code: errorCode,
        });
        throw err;
      }
      const llmLatencyMs = Date.now() - llmStart;
      request.log.info({ event: 'SQL_GENERATED', llm_latency_ms: llmLatencyMs }, 'SQL generated');

      // 4. Validate SQL at the AST level
      let validatedSql: string;
      let statementType: string;
      try {
        const validated = validateSql(rawSql, schema, mode);
        validatedSql = validated.sql;
        statementType = validated.statementType;
        request.log.info({ event: 'QUERY_EXECUTED', validation_passed: true }, 'SQL validated');
      } catch (err) {
        request.log.warn({ event: 'VALIDATION_FAILED', validation_passed: false }, 'SQL validation failed');
        const errorCode = err instanceof AppError ? err.type : ErrorType.INVALID_SQL;
        await insertHistory(pool, {
          nl_query: query,
          generated_sql: rawSql,
          mode,
          type: 'READ',
          execution_time_ms: Date.now() - startMs,
          status: 'failure',
          error_code: errorCode,
        });
        throw err;
      }

      // 4b. RBAC — validate table access when user context headers are present
      const hasUserContext =
        request.headers['x-user-id'] || request.headers['x-user-role'];
      if (hasUserContext) {
        try {
          const userContext = extractUserContext(
            request.headers as Record<string, string | undefined>,
          );
          const rbacRole = await loadUserRole(pool, userContext.userId);
          const accessedTables = extractTablesFromSql(validatedSql);
          validateAccess(userContext, rbacRole, accessedTables, mode);
        } catch (err) {
          const errorCode = err instanceof AppError ? err.type : ErrorType.TABLE_ACCESS_DENIED;
          await insertHistory(pool, {
            nl_query: query,
            generated_sql: validatedSql,
            mode,
            type: 'READ',
            execution_time_ms: Date.now() - startMs,
            status: 'failure',
            error_code: errorCode,
          });
          throw err;
        }
      }

      // 5. Format SQL for human-readable responses
      const formattedSql = formatSql(validatedSql);

      // ── SELECT ──────────────────────────────────────────────────────────────

      if (statementType === 'SELECT') {
        request.log.info({ sql: validatedSql }, 'Executing SELECT query');

        // 5b. Cost estimation — run EXPLAIN before executing
        const costEstimation = await estimateQueryCost(pool, validatedSql);
        try {
          assertCostAcceptable(costEstimation);
        } catch (err) {
          const errorCode = err instanceof AppError ? err.type : ErrorType.QUERY_TOO_EXPENSIVE;
          await insertHistory(pool, {
            nl_query: query,
            generated_sql: validatedSql,
            mode,
            type: 'READ',
            execution_time_ms: Date.now() - startMs,
            status: 'failure',
            error_code: errorCode,
          });
          return reply.status(400).send({
            error: 'QUERY_TOO_EXPENSIVE',
            message: err instanceof AppError ? err.message : 'Query cost exceeds threshold.',
            estimation: costEstimation,
          });
        }

        const dbStart = Date.now();
        let rows: Record<string, unknown>[];
        let rowCount: number;
        try {
          const result = await executeQuery(validatedSql);
          rows = result.rows;
          rowCount = result.rowCount;
        } catch (err) {
          const errorCode = err instanceof AppError ? err.type : ErrorType.EXECUTION_ERROR;
          await insertHistory(pool, {
            nl_query: query,
            generated_sql: validatedSql,
            mode,
            type: 'READ',
            execution_time_ms: Date.now() - startMs,
            status: 'failure',
            error_code: errorCode,
          });
          throw err;
        }
        const dbExecutionMs = Date.now() - dbStart;
        request.log.info({ event: 'QUERY_EXECUTED', db_execution_ms: dbExecutionMs, row_count: rowCount }, 'SELECT executed');

        const explanation = await explainSql(validatedSql);

        const result: QueryResponse = {
          query: formattedSql,
          explanation,
          data: rows,
          row_count: rowCount,
          type: 'READ',
        };

        if (redis) {
          await setCachedResult(redis, query, schemaVersion, result);
        }

        await insertHistory(pool, {
          nl_query: query,
          generated_sql: validatedSql,
          mode,
          type: 'READ',
          execution_time_ms: Date.now() - startMs,
          row_count: rowCount,
          status: 'success',
        });

        request.log.info({ event: 'QUERY_EXECUTED', total_request_ms: Date.now() - startMs }, 'Request complete');
        return reply.send({ ...result, cost_estimation: costEstimation });
      }

      // ── INSERT — execute directly, no confirmation required ──────────────

      if (statementType === 'INSERT') {
        request.log.info({ sql: validatedSql }, 'Executing INSERT query');
        let rows: Record<string, unknown>[];
        let rowCount: number;
        try {
          const result = await executeQuery(validatedSql);
          rows = result.rows;
          rowCount = result.rowCount;
        } catch (err) {
          const errorCode = err instanceof AppError ? err.type : ErrorType.EXECUTION_ERROR;
          await insertHistory(pool, {
            nl_query: query,
            generated_sql: validatedSql,
            mode,
            type: 'WRITE',
            execution_time_ms: Date.now() - startMs,
            status: 'failure',
            error_code: errorCode,
          });
          throw err;
        }
        const explanation = await explainSql(validatedSql);

        await insertHistory(pool, {
          nl_query: query,
          generated_sql: validatedSql,
          mode,
          type: 'WRITE',
          execution_time_ms: Date.now() - startMs,
          affected_rows: rowCount,
          status: 'success',
        });

        request.log.info({ event: 'WRITE_CONFIRMED', affected_rows: rowCount }, 'INSERT executed');
        return reply.send({
          query: formattedSql,
          explanation,
          data: rows,
          row_count: rowCount,
          type: 'WRITE',
          affected_rows: rowCount,
        });
      }

      // ── UPDATE / DELETE — dry-run preview + confirmation token ───────────

      if (statementType === 'UPDATE' || statementType === 'DELETE') {
        request.log.info({ sql: validatedSql, statementType }, 'Running dry-run preview');

        const previewSql = buildPreviewSql(validatedSql);
        const { rows: previewRows, rowCount: previewCount } = await executeQuery(previewSql);
        const explanation = await explainSql(validatedSql);

        const warning =
          statementType === 'DELETE'
            ? `You are about to delete ${previewCount} rows. This cannot be undone.`
            : `This will modify ${previewCount} records.`;

        const token = await storePendingWrite(
          redis,
          { sql: validatedSql, formattedSql, explanation, operation: statementType },
          config.query.pendingWriteTtlSeconds,
        );

        const confirmation: WriteConfirmationResponse = {
          status: 'AWAITING_CONFIRMATION',
          type: 'WRITE',
          operation: statementType,
          impact: {
            affected_rows: previewCount,
            preview: previewRows.slice(0, 10),
            warning,
          },
          query: formattedSql,
          explanation,
          confirmation_token: token,
          confirm_to_proceed: `POST { "token": "${token}" } to /api/query/confirm to execute`,
        };

        return reply.send(confirmation);
      }

      return reply.status(500).send({ error: { type: 'INTERNAL_ERROR', message: 'Unhandled statement type' } });
    },
  );

  /**
   * POST /api/query/confirm
   *
   * Accepts { token } — the confirmation_token returned by a previous
   * /api/query call for an UPDATE or DELETE operation.
   *
   * Looks up the pending write, executes the exact SQL that was previewed,
   * and returns the result. A token can only be used once.
   */
  fastify.post<{ Body: ConfirmWriteRequest }>(
    '/api/query/confirm',
    {
      schema: {
        body: confirmBodySchema,
        response: queryResponseSchema,
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest<{ Body: ConfirmWriteRequest }>, reply: FastifyReply) => {
      const { token } = request.body;

      const pending = await getPendingWrite(redis, token);

      if (!pending) {
        return reply.status(404).send({
          error: {
            type: 'TOKEN_NOT_FOUND',
            message: 'Confirmation token not found or has expired. Request a new preview first.',
          },
        });
      }

      request.log.info({ sql: pending.sql, operation: pending.operation }, 'Executing confirmed write');
      const { rows, rowCount } = await executeQuery(pending.sql);

      return reply.send({
        query: pending.formattedSql,
        explanation: pending.explanation,
        data: rows,
        row_count: rowCount,
        type: 'WRITE',
        affected_rows: rowCount,
      });
    },
  );

  /**
   * POST /admin/refresh-schema
   */
  fastify.post('/admin/refresh-schema', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = getPool();
    await refreshSchemaFromDb(pool, redis);
    return reply.send({ ok: true, message: 'Schema refreshed' });
  });

  /**
   * GET /health
   */
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = getPool();
    let dbStatus: 'connected' | 'error' = 'error';
    let redisStatus: 'connected' | 'error' | 'disabled' = 'disabled';

    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    if (redis) {
      try {
        await redis.ping();
        redisStatus = 'connected';
      } catch {
        redisStatus = 'error';
      }
    }

    const overallStatus = dbStatus === 'connected' ? 'ok' : 'degraded';

    return reply.status(overallStatus === 'ok' ? 200 : 503).send({
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    });
  });
}
