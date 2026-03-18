import { submitFeedback, getFeedbackStats } from './feedbackService';
import { ErrorType } from '../types/errors';
import type { Pool } from 'pg';

function makeMockPool(responses: { rows: unknown[] }[]): Pool {
  const mock = jest.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce(r);
  }
  return { query: mock } as unknown as Pool;
}

describe('submitFeedback', () => {
  const baseParams = {
    history_id: 'hist-uuid',
    user_id: 'user-1',
    feedback: 'up' as const,
    comment: 'Great query!',
  };

  const successEntry = {
    id: 'feedback-uuid',
    history_id: 'hist-uuid',
    user_id: 'user-1',
    feedback: 'up',
    comment: 'Great query!',
    created_at: '2024-01-01T00:00:00Z',
  };

  it('inserts feedback and returns the entry', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'hist-uuid' }] }, // history check
      { rows: [] },                     // duplicate check
      { rows: [successEntry] },         // insert
    ]);

    const result = await submitFeedback(pool, baseParams);

    expect(result).toEqual(successEntry);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('throws INVALID_FEEDBACK_VALUE for invalid feedback', async () => {
    const pool = makeMockPool([]);

    await expect(
      submitFeedback(pool, { ...baseParams, feedback: 'meh' as 'up' }),
    ).rejects.toThrow(expect.objectContaining({ type: ErrorType.INVALID_FEEDBACK_VALUE }));
  });

  it('throws INVALID_FEEDBACK_VALUE for comment exceeding 500 chars', async () => {
    const pool = makeMockPool([]);

    await expect(
      submitFeedback(pool, { ...baseParams, comment: 'x'.repeat(501) }),
    ).rejects.toThrow(expect.objectContaining({ type: ErrorType.INVALID_FEEDBACK_VALUE }));
  });

  it('throws HISTORY_NOT_FOUND when history_id does not exist', async () => {
    const pool = makeMockPool([{ rows: [] }]); // history check returns empty

    await expect(submitFeedback(pool, baseParams)).rejects.toThrow(
      expect.objectContaining({ type: ErrorType.HISTORY_NOT_FOUND }),
    );
  });

  it('throws FEEDBACK_ALREADY_SUBMITTED for duplicate submission', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'hist-uuid' }] },         // history check
      { rows: [{ id: 'existing-feedback' }] }, // duplicate check finds one
    ]);

    await expect(submitFeedback(pool, baseParams)).rejects.toThrow(
      expect.objectContaining({ type: ErrorType.FEEDBACK_ALREADY_SUBMITTED }),
    );
  });

  it('allows feedback without user_id (skips duplicate check)', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'hist-uuid' }] }, // history check
      { rows: [successEntry] },         // insert (no duplicate check)
    ]);

    const result = await submitFeedback(pool, { ...baseParams, user_id: null });
    expect(result).toEqual(successEntry);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe('getFeedbackStats', () => {
  it('returns aggregated stats', async () => {
    const pool = makeMockPool([
      { rows: [{ total: '10', up: '7', down: '3' }] },
      { rows: [{ history_id: 'h1', up_count: '5' }] },
      { rows: [{ history_id: 'h2', down_count: '2' }] },
    ]);

    const stats = await getFeedbackStats(pool);

    expect(stats.total).toBe(10);
    expect(stats.up).toBe(7);
    expect(stats.down).toBe(3);
    expect(stats.up_percentage).toBe(70);
    expect(stats.top_rated).toEqual([{ history_id: 'h1', up_count: 5 }]);
    expect(stats.most_disliked).toEqual([{ history_id: 'h2', down_count: 2 }]);
  });

  it('returns zero percentage when total is 0', async () => {
    const pool = makeMockPool([
      { rows: [{ total: '0', up: '0', down: '0' }] },
      { rows: [] },
      { rows: [] },
    ]);

    const stats = await getFeedbackStats(pool);
    expect(stats.up_percentage).toBe(0);
  });
});
