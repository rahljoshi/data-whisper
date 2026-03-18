import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { submitFeedback, getFeedbackStats } from '../../feedback/feedbackService';

interface FeedbackBody {
  history_id: string;
  feedback: 'up' | 'down';
  comment?: string;
}

const feedbackBodySchema = {
  type: 'object',
  required: ['history_id', 'feedback'],
  properties: {
    history_id: { type: 'string', minLength: 1 },
    feedback: { type: 'string', enum: ['up', 'down'] },
    comment: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
};

export async function feedbackRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool },
): Promise<void> {
  const { pool } = options;

  /**
   * POST /api/feedback
   * Submit thumbs-up / thumbs-down for a query history entry.
   * User identity is read from X-User-Id header (optional).
   */
  fastify.post<{ Body: FeedbackBody }>(
    '/api/feedback',
    { schema: { body: feedbackBodySchema } },
    async (request: FastifyRequest<{ Body: FeedbackBody }>, reply: FastifyReply) => {
      const { history_id, feedback, comment } = request.body;
      const userId = (request.headers['x-user-id'] as string | undefined) ?? null;

      const entry = await submitFeedback(pool, {
        history_id,
        user_id: userId,
        feedback,
        comment: comment ?? null,
      });

      return reply.status(201).send(entry);
    },
  );

  /**
   * GET /api/feedback/stats
   * Returns aggregated feedback statistics.
   */
  fastify.get(
    '/api/feedback/stats',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = await getFeedbackStats(pool);
      return reply.send(stats);
    },
  );
}
