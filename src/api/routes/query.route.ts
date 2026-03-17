import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateSql } from '../../ai/sqlGenerator';
import { explainSql } from '../../ai/sqlExplainer';
import { validateSql, buildPreviewSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion, refreshSchemaFromDb } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import { storePendingWrite, getPendingWrite } from '../../cache/pendingWriteStore';
import type { QueryRequest, ConfirmWriteRequest, QueryResponse, WriteConfirmationResponse } from '../../types/api';
import { getPool } from '../../execution/queryExecutor';
import { config } from '../../config';
import type { Redis } from 'ioredis';

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
  options: { redis: Redis | null },
): Promise<void> {
  const { redis } = options;

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
    },
    async (request: FastifyRequest<{ Body: QueryRequest }>, reply: FastifyReply) => {
      const { query } = request.body;
      const mode = config.query.mode;

      // 1. Cache lookup — SELECT / READ_ONLY only
      const schemaVersion = getSchemaVersion();
      if (mode === 'READ_ONLY' && redis) {
        const cached = await getCachedResult(redis, query, schemaVersion);
        if (cached) {
          request.log.info({ cacheHit: true }, 'Serving result from cache');
          return reply.send(cached);
        }
      }

      // 2. Get schema
      const schema = getSchema();

      // 3. Generate SQL (mode is service-level)
      request.log.info({ mode }, 'Generating SQL from query');
      const rawSql = await generateSql(query, schema, mode);

      // 4. Validate SQL at the AST level
      request.log.info({ rawSql, mode }, 'Validating generated SQL');
      const { sql: validatedSql, statementType } = validateSql(rawSql, schema, mode);

      // 5. Format SQL for human-readable responses
      const formattedSql = formatSql(validatedSql);

      // ── SELECT ──────────────────────────────────────────────────────────────

      if (statementType === 'SELECT') {
        request.log.info({ sql: validatedSql }, 'Executing SELECT query');
        const { rows, rowCount } = await executeQuery(validatedSql);
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

        return reply.send(result);
      }

      // ── INSERT — execute directly, no confirmation required ──────────────

      if (statementType === 'INSERT') {
        request.log.info({ sql: validatedSql }, 'Executing INSERT query');
        const { rows, rowCount } = await executeQuery(validatedSql);
        const explanation = await explainSql(validatedSql);

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
