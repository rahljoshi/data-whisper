import type { Pool } from 'pg';
import { AppError, ErrorType } from '../types/errors';

export type FeedbackValue = 'up' | 'down';

export interface FeedbackEntry {
  id: string;
  history_id: string;
  user_id: string | null;
  feedback: FeedbackValue;
  comment: string | null;
  created_at: string;
}

export interface SubmitFeedbackParams {
  history_id: string;
  user_id: string | null;
  feedback: FeedbackValue;
  comment?: string | null;
}

export interface FeedbackStats {
  total: number;
  up: number;
  down: number;
  up_percentage: number;
  top_rated: { history_id: string; up_count: number }[];
  most_disliked: { history_id: string; down_count: number }[];
}

const VALID_FEEDBACK: Set<string> = new Set(['up', 'down']);
const MAX_COMMENT_LENGTH = 500;

/**
 * Submit feedback for a history entry.
 * Validates history_id exists, feedback value, comment length, and uniqueness per user.
 */
export async function submitFeedback(
  pool: Pool,
  params: SubmitFeedbackParams,
): Promise<FeedbackEntry> {
  const { history_id, user_id, feedback, comment } = params;

  if (!VALID_FEEDBACK.has(feedback)) {
    throw new AppError(
      ErrorType.INVALID_FEEDBACK_VALUE,
      `Feedback must be 'up' or 'down'. Got: '${feedback}'.`,
    );
  }

  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    throw new AppError(
      ErrorType.INVALID_FEEDBACK_VALUE,
      `Comment must not exceed ${MAX_COMMENT_LENGTH} characters.`,
    );
  }

  // Validate history_id exists
  const historyCheck = await pool.query<{ id: string }>(
    'SELECT id FROM query_history WHERE id = $1',
    [history_id],
  );

  if (historyCheck.rows.length === 0) {
    throw new AppError(
      ErrorType.HISTORY_NOT_FOUND,
      `History entry '${history_id}' not found.`,
    );
  }

  // Check for duplicate feedback (only when user_id is provided)
  if (user_id) {
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM query_feedback WHERE user_id = $1 AND history_id = $2',
      [user_id, history_id],
    );

    if (existing.rows.length > 0) {
      throw new AppError(
        ErrorType.FEEDBACK_ALREADY_SUBMITTED,
        `Feedback already submitted for this query by user '${user_id}'.`,
      );
    }
  }

  const result = await pool.query<FeedbackEntry>(
    `INSERT INTO query_feedback (history_id, user_id, feedback, comment)
     VALUES ($1, $2, $3, $4)
     RETURNING id, history_id, user_id, feedback, comment,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
    [history_id, user_id ?? null, feedback, comment ?? null],
  );

  return result.rows[0];
}

/**
 * Get aggregated feedback statistics.
 */
export async function getFeedbackStats(pool: Pool): Promise<FeedbackStats> {
  const [totalsResult, topRatedResult, mostDislikedResult] = await Promise.all([
    pool.query<{ total: string; up: string; down: string }>(`
      SELECT
        COUNT(*)::text AS total,
        SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END)::text AS up,
        SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END)::text AS down
      FROM query_feedback
    `),
    pool.query<{ history_id: string; up_count: string }>(`
      SELECT history_id, COUNT(*)::text AS up_count
      FROM query_feedback
      WHERE feedback = 'up'
      GROUP BY history_id
      ORDER BY up_count DESC
      LIMIT 5
    `),
    pool.query<{ history_id: string; down_count: string }>(`
      SELECT history_id, COUNT(*)::text AS down_count
      FROM query_feedback
      WHERE feedback = 'down'
      GROUP BY history_id
      ORDER BY down_count DESC
      LIMIT 5
    `),
  ]);

  const totals = totalsResult.rows[0];
  const total = parseInt(totals.total ?? '0', 10);
  const up = parseInt(totals.up ?? '0', 10);
  const down = parseInt(totals.down ?? '0', 10);

  return {
    total,
    up,
    down,
    up_percentage: total > 0 ? Math.round((up / total) * 10000) / 100 : 0,
    top_rated: topRatedResult.rows.map((r) => ({
      history_id: r.history_id,
      up_count: parseInt(r.up_count, 10),
    })),
    most_disliked: mostDislikedResult.rows.map((r) => ({
      history_id: r.history_id,
      down_count: parseInt(r.down_count, 10),
    })),
  };
}
