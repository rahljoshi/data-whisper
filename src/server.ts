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
    },
    trustProxy: true,
  });

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
    errorResponseBuilder: () => ({
      error: {
        type: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
      },
    }),
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  await fastify.register(errorHandlerPlugin);

  // ── Redis ─────────────────────────────────────────────────────────────────

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

  await fastify.register(queryRoutes, { redis });

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
