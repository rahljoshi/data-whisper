import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { config } from './config';
import { loadSchema, startSchemaRefreshTimer, stopSchemaRefreshTimer } from './schema/schemaService';
import { getPool, closePool, testConnection } from './execution/queryExecutor';
import { errorHandlerPlugin } from './api/plugins/errorHandler';
import { queryRoutes } from './api/routes/query.route';
import { historyRoutes } from './api/routes/history.route';
import { schemaVersionRoutes } from './api/routes/schema.route';
import { metricsRoutes } from './api/routes/metrics.route';
import { feedbackRoutes } from './api/routes/feedback.route';

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.server.isDev ? 'debug' : 'info',
      ...(config.server.isDev && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            request_id: req.id,
          };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  // ── Redis (initialized first so it can back the rate limiter) ─────────────

  let redis: Redis | null = null;

  try {
    redis = new Redis(config.redis.url, {
      password: config.redis.password,
      tls: config.redis.tls ? {} : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });

    await redis.connect();
    fastify.log.info('Redis connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fastify.log.warn(`Redis unavailable — cache disabled: ${message}`);
    redis = null;
  }

  // ── Security plugins ──────────────────────────────────────────────────────

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(cors, {
    origin: config.server.isDev ? true : false,
    methods: ['GET', 'POST'],
  });

  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    redis: redis ?? undefined,
    keyGenerator: (request) => {
      return (request.headers['x-user-id'] as string) ?? request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait before retrying.',
      retry_after_seconds: Math.ceil(context.ttl / 1000),
    }),
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  await fastify.register(errorHandlerPlugin);

  // ── Database ──────────────────────────────────────────────────────────────

  const pool = getPool();

  try {
    await testConnection();
    fastify.log.info('PostgreSQL connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fastify.log.error(`PostgreSQL connection failed: ${message}`);
    throw err;
  }

  // ── Schema introspection ─────────────────────────────────────────────────

  fastify.log.info('Loading database schema...');
  await loadSchema(pool, redis);
  fastify.log.info('Schema loaded');

  startSchemaRefreshTimer(pool, redis);

  // ── Routes ────────────────────────────────────────────────────────────────

  await fastify.register(queryRoutes, { redis, pool });
  await fastify.register(historyRoutes, { pool, redis });
  await fastify.register(schemaVersionRoutes, { redis });
  await fastify.register(metricsRoutes, { pool });
  await fastify.register(feedbackRoutes, { pool });

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}. Shutting down gracefully...`);
    stopSchemaRefreshTimer();

    await fastify.close();

    if (redis) {
      redis.disconnect();
    }

    await closePool();

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();
    await server.listen({ port: config.server.port, host: config.server.host });
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

start();
