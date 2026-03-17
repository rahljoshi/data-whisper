import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateSql } from '../../ai/sqlGenerator';
import { explainSql } from '../../ai/sqlExplainer';
import { validateSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion, refreshSchemaFromDb } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import type { QueryRequest, QueryResponse } from '../../types/api';
import { getPool } from '../../execution/queryExecutor';
import type { Redis } from 'ioredis';

// JSON Schema for Fastify request validation
const queryBodySchema = {
  type: 'object',
  required: ['question'],
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
    },
  },
  additionalProperties: false,
};

const queryResponseSchema = {
  200: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      explanation: { type: 'string' },
      data: { type: 'array' },
      row_count: { type: 'integer' },
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
   * Main pipeline: NL → SQL → validate → execute → explain → cache → respond
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
      const { question } = request.body;

      // 1. Cache lookup
      const schemaVersion = getSchemaVersion();
      if (redis) {
        const cached = await getCachedResult(redis, question, schemaVersion);
        if (cached) {
          request.log.info({ cacheHit: true }, 'Serving result from cache');
          return reply.send(cached);
        }
      }

      // 2. Get schema
      const schema = getSchema();

      // 3. Generate SQL
      request.log.info('Generating SQL from question');
      const rawSql = await generateSql(question, schema);

      // 4. Validate SQL (AST-level)
      request.log.info({ rawSql }, 'Validating generated SQL');
      const validatedSql = validateSql(rawSql, schema);

      // 5. Format SQL for human-readable response (execution uses unformatted — same semantics)
      const formattedSql = formatSql(validatedSql);

      // 6. Execute query
      request.log.info({ sql: validatedSql }, 'Executing validated SQL');
      const { rows, rowCount } = await executeQuery(validatedSql);

      if (rowCount === 0) {
        request.log.info('Query returned no rows');
      }

      // 7. Explain SQL
      const explanation = await explainSql(validatedSql);

      // 8. Build response
      const result: QueryResponse = {
        query: formattedSql,
        explanation,
        data: rows,
        row_count: rowCount,
      };

      // 8. Write to cache
      if (redis) {
        await setCachedResult(redis, question, schemaVersion, result);
      }

      return reply.send(result);
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
