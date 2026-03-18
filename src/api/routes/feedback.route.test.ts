import Fastify from 'fastify';
import { feedbackRoutes } from './feedback.route';
import * as feedbackService from '../../feedback/feedbackService';
import type { FeedbackEntry } from '../../feedback/feedbackService';
import { AppError, ErrorType } from '../../types/errors';
import type { Pool } from 'pg';

jest.mock('../../feedback/feedbackService');

const mockPool = {} as Pool;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(feedbackRoutes, { pool: mockPool });
  return app;
}

describe('POST /api/feedback', () => {
  const validPayload = { history_id: 'hist-uuid', feedback: 'up', comment: 'Great!' };
  const successEntry: FeedbackEntry = {
    id: 'fb-uuid',
    history_id: 'hist-uuid',
    user_id: null,
    feedback: 'up',
    comment: 'Great!',
    created_at: '2024-01-01T00:00:00Z',
  };

  it('returns 201 with the created feedback entry', async () => {
    jest.mocked(feedbackService.submitFeedback).mockResolvedValue(successEntry);

    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validPayload,
    });

    expect(resp.statusCode).toBe(201);
    expect(resp.json()).toEqual(successEntry);
  });

  it('passes X-User-Id header to submitFeedback', async () => {
    jest.mocked(feedbackService.submitFeedback).mockResolvedValue(successEntry);

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { 'x-user-id': 'user-123' },
      payload: validPayload,
    });

    expect(feedbackService.submitFeedback).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ user_id: 'user-123' }),
    );
  });

  it('returns 400 for missing history_id', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { feedback: 'up' },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 400 for invalid feedback value', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { history_id: 'hist-uuid', feedback: 'meh' },
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 404 when history entry not found', async () => {
    jest.mocked(feedbackService.submitFeedback).mockRejectedValue(
      new AppError(ErrorType.HISTORY_NOT_FOUND, 'Not found'),
    );

    const app = await buildApp();

    // Need error handler plugin
    const { errorHandlerPlugin } = await import('../plugins/errorHandler');
    await app.register(errorHandlerPlugin);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validPayload,
    });
    expect(resp.statusCode).toBe(404);
  });

  it('returns 400 when feedback already submitted', async () => {
    jest.mocked(feedbackService.submitFeedback).mockRejectedValue(
      new AppError(ErrorType.FEEDBACK_ALREADY_SUBMITTED, 'Already submitted'),
    );

    const app = await buildApp();
    const { errorHandlerPlugin } = await import('../plugins/errorHandler');
    await app.register(errorHandlerPlugin);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: validPayload,
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe('GET /api/feedback/stats', () => {
  it('returns aggregated feedback stats', async () => {
    const stats = {
      total: 10,
      up: 7,
      down: 3,
      up_percentage: 70,
      top_rated: [],
      most_disliked: [],
    };
    jest.mocked(feedbackService.getFeedbackStats).mockResolvedValue(stats);

    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: '/api/feedback/stats' });

    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual(stats);
  });
});
