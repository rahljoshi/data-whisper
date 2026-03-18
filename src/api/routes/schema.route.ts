import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSchemaSnapshot, getSchemaTableCount } from '../../schema/schemaService';
import type { Redis } from 'ioredis';

export async function schemaVersionRoutes(
  fastify: FastifyInstance,
  _options: { redis: Redis | null },
): Promise<void> {
  /**
   * GET /api/schema/version
   * Returns the current schema hash, table count, and last loaded timestamp.
   */
  fastify.get(
    '/api/schema/version',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const snap = getSchemaSnapshot();
      return reply.send({
        hash: snap.version,
        table_count: getSchemaTableCount(),
        last_updated: snap.loadedAt.toISOString(),
      });
    },
  );
}
