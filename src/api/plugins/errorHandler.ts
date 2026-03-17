import type { FastifyInstance, FastifyError } from 'fastify';
import { AppError } from '../../types/errors';

/**
 * Register a global error handler that converts AppError and Fastify validation
 * errors into the structured { error: { type, message } } shape.
 */
export async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    // Known application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Fastify schema validation errors (400)
    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode === 400 || fastifyError.validation) {
      return reply.status(400).send({
        error: {
          type: 'VALIDATION_ERROR',
          message: error.message ?? 'Invalid request',
        },
      });
    }

    // Rate limit errors (429) from @fastify/rate-limit
    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({
        error: {
          type: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down.',
        },
      });
    }

    // Unexpected errors — log and return a generic 500
    fastify.log.error(error);
    return reply.status(500).send({
      error: {
        type: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });
}
