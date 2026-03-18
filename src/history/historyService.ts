import type { Pool } from 'pg';
import type { QueryMode } from '../types/api';

export interface HistoryEntry {
  id: string;
  nl_query: string;
  generated_sql: string;
  mode: QueryMode;
  type: 'READ' | 'WRITE';
  execution_time_ms: number;
  row_count: number | null;
  affected_rows: number | null;
  status: 'success' | 'failure';
  error_code: string | null;
  created_at: string;
}

export interface InsertHistoryParams {
  nl_query: string;
  generated_sql: string;
  mode: QueryMode;
  type: 'READ' | 'WRITE';
  execution_time_ms: number;
  row_count?: number | null;
  affected_rows?: number | null;
  status: 'success' | 'failure';
  error_code?: string | null;
}

export interface HistoryFilters {
  mode?: QueryMode;
  status?: 'success' | 'failure';
  limit?: number;
}

/**
 * Insert a new query history entry. Non-fatal — never throws.
 */
export async function insertHistory(
  pool: Pool,
  params: InsertHistoryParams,
): Promise<string | null> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO query_history
         (nl_query, generated_sql, mode, type, execution_time_ms, row_count, affected_rows, status, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        params.nl_query,
        params.generated_sql,
        params.mode,
        params.type,
        params.execution_time_ms,
        params.row_count ?? null,
        params.affected_rows ?? null,
        params.status,
        params.error_code ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Retrieve history entries with optional filters. Newest first, max 50 by default.
 */
export async function getHistory(
  pool: Pool,
  filters: HistoryFilters = {},
): Promise<HistoryEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.mode) {
    conditions.push(`mode = $${idx++}`);
    values.push(filters.mode);
  }

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 50, 50);
  values.push(limit);

  const result = await pool.query<HistoryEntry>(
    `SELECT id, nl_query, generated_sql, mode, type, execution_time_ms,
            row_count, affected_rows, status, error_code,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM query_history
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    values,
  );

  return result.rows;
}

/**
 * Retrieve a single history entry by ID.
 */
export async function getHistoryById(
  pool: Pool,
  id: string,
): Promise<HistoryEntry | null> {
  const result = await pool.query<HistoryEntry>(
    `SELECT id, nl_query, generated_sql, mode, type, execution_time_ms,
            row_count, affected_rows, status, error_code,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM query_history
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
