import { insertHistory, getHistory, getHistoryById } from './historyService';
import type { Pool } from 'pg';

function makeMockPool(rows: unknown[] = [], id = 'abc-123'): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: rows.length ? rows : [{ id }] }),
  } as unknown as Pool;
}

describe('historyService', () => {
  describe('insertHistory', () => {
    it('inserts a history entry and returns the id', async () => {
      const pool = makeMockPool([{ id: 'test-uuid' }]);

      const result = await insertHistory(pool, {
        nl_query: 'Show all users',
        generated_sql: 'SELECT * FROM users LIMIT 100',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 42,
        row_count: 10,
        affected_rows: null,
        status: 'success',
      });

      expect(result).toBe('test-uuid');
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('returns null and does not throw when DB throws', async () => {
      const pool = {
        query: jest.fn().mockRejectedValue(new Error('DB error')),
      } as unknown as Pool;

      const result = await insertHistory(pool, {
        nl_query: 'Show all users',
        generated_sql: 'SELECT * FROM users LIMIT 100',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 42,
        status: 'failure',
        error_code: 'TIMEOUT',
      });

      expect(result).toBeNull();
    });

    it('stores failure entries with error_code', async () => {
      const pool = makeMockPool([{ id: 'fail-uuid' }]);

      const result = await insertHistory(pool, {
        nl_query: 'delete everything',
        generated_sql: '',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 5,
        status: 'failure',
        error_code: 'WRITE_NOT_ALLOWED',
      });

      expect(result).toBe('fail-uuid');
      const callArgs = (pool.query as jest.Mock).mock.calls[0][1];
      expect(callArgs[7]).toBe('failure');
      expect(callArgs[8]).toBe('WRITE_NOT_ALLOWED');
    });
  });

  describe('getHistory', () => {
    const mockRows = [
      {
        id: 'uuid-1',
        nl_query: 'Show all users',
        generated_sql: 'SELECT * FROM users LIMIT 100',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 42,
        row_count: 10,
        affected_rows: null,
        status: 'success',
        error_code: null,
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('returns history entries with default limit 50', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: mockRows }) } as unknown as Pool;

      const result = await getHistory(pool);

      expect(result).toEqual(mockRows);
      const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('applies mode filter', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

      await getHistory(pool, { mode: 'CRUD_ENABLED' });

      const [sql, values] = (pool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('mode');
      expect(values).toContain('CRUD_ENABLED');
    });

    it('applies status filter', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

      await getHistory(pool, { status: 'failure' });

      const [sql, values] = (pool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('status');
      expect(values).toContain('failure');
    });

    it('caps limit at 50 even if higher value is requested', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

      await getHistory(pool, { limit: 200 });

      const values = (pool.query as jest.Mock).mock.calls[0][1] as unknown[];
      expect(values[values.length - 1]).toBe(50);
    });
  });

  describe('getHistoryById', () => {
    it('returns a single entry when found', async () => {
      const entry = {
        id: 'uuid-1',
        nl_query: 'Show users',
        generated_sql: 'SELECT * FROM users LIMIT 100',
        mode: 'READ_ONLY',
        type: 'READ',
        execution_time_ms: 10,
        row_count: 5,
        affected_rows: null,
        status: 'success',
        error_code: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const pool = { query: jest.fn().mockResolvedValue({ rows: [entry] }) } as unknown as Pool;

      const result = await getHistoryById(pool, 'uuid-1');

      expect(result).toEqual(entry);
    });

    it('returns null when entry not found', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;

      const result = await getHistoryById(pool, 'nonexistent');

      expect(result).toBeNull();
    });
  });
});
