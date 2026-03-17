import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateSql } from '../../ai/sqlGenerator';
import { explainSql } from '../../ai/sqlExplainer';
import { validateSql, buildPreviewSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion, refreshSchemaFromDb } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import type { QueryRequest, QueryResponse, WriteConfirmationResponse } from '../../types/api';
import { getPool } from '../../execution/queryExecutor';
import type { Redis } from 'ioredis';

// JSON Schema for Fastify request validation
const queryBodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
    },
    mode: {
      type: 'string',
      enum: ['READ_ONLY', 'CRUD_ENABLED'],
    },
    confirm_write: {
      type: 'boolean',
    },
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
      impact: {
        type: 'object',
        properties: {
          affected_rows: { type: 'integer' },
          preview: { type: 'array', items: { type: 'object', additionalProperties: true } },
          warning: { type: 'string' },
        },
        additionalProperties: true,
      },
      confirm_to_proceed: { type: 'string' },
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

export async function queryRoutes(
  fastify: FastifyInstance,
  options: { redis: Redis | null },
): Promise<void> {
  const { redis } = options;

  /**
   * POST /api/query
   * Main pipeline: NL → SQL → validate → execute → explain → respond
   *
   * Supports READ_ONLY and CRUD_ENABLED modes.
   * UPDATE/DELETE require confirm_write: true to execute; without it, a
   * dry-run preview is returned as AWAITING_CONFIRMATION.
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
      const { query, mode = 'READ_ONLY', confirm_write } = request.body;

      // 1. Cache lookup — only for READ_ONLY SELECT operations
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

      // 3. Generate SQL with mode
      request.log.info({ mode }, 'Generating SQL from query');
      const rawSql = await generateSql(query, schema, mode);

      // 4. Validate SQL (AST-level) with mode
      request.log.info({ rawSql, mode }, 'Validating generated SQL');
      const { sql: validatedSql, statementType } = validateSql(rawSql, schema, mode);

      // 5. Format SQL for human-readable response
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

      // ── INSERT — execute directly, no confirmation needed ────────────────

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

      // ── UPDATE / DELETE — require confirmation ───────────────────────────

      if (statementType === 'UPDATE' || statementType === 'DELETE') {
        if (!confirm_write) {
          // Dry-run: build a preview SELECT and execute it
          request.log.info({ sql: validatedSql, statementType }, 'Running dry-run preview');
          const previewSql = buildPreviewSql(validatedSql);
          const { rows: previewRows, rowCount: previewCount } = await executeQuery(previewSql);

          const explanation = await explainSql(validatedSql);

          const warning =
            statementType === 'DELETE'
              ? `You are about to delete ${previewCount} rows. This cannot be undone.`
              : `This will modify ${previewCount} records.`;

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
            confirm_to_proceed: 'Resend with confirm_write: true to execute',
          };

          return reply.send(confirmation);
        }

        // confirm_write: true — execute the write
        request.log.info({ sql: validatedSql, statementType }, 'Executing confirmed write query');
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

      // Unreachable — all statement types are handled above
      return reply.status(500).send({ error: { type: 'INTERNAL_ERROR', message: 'Unhandled statement type' } });
    },
  );

  /**
   * POST /admin/refresh-schema
   * Force-reload the database schema and invalidate the schema cache.
   */
  fastify.post('/admin/refresh-schema', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = getPool();
    await refreshSchemaFromDb(pool, redis);
    return reply.send({ ok: true, message: 'Schema refreshed' });
  });

  /**
   * GET /health
   * Liveness/readiness probe with service connectivity checks.
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
