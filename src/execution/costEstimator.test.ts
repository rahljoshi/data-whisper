import { estimateQueryCost, assertCostAcceptable } from './costEstimator';
import { ErrorType } from '../types/errors';
import type { Pool } from 'pg';

jest.mock('../config', () => ({
  config: {
    costEstimation: {
      queryCostThreshold: 10000,
      seqScanRowThreshold: 100000,
    },
  },
}));

function mockPool(planLines: string[]): Pool {
  return {
    query: jest.fn().mockResolvedValue({
      rows: planLines.map((line) => ({ 'QUERY PLAN': line })),
    }),
  } as unknown as Pool;
}

describe('estimateQueryCost', () => {
  it('extracts total cost from EXPLAIN output', async () => {
    const pool = mockPool([
      'Seq Scan on customers  (cost=0.00..18.50 rows=850 width=68)',
    ]);

    const result = await estimateQueryCost(pool, 'SELECT * FROM customers');

    expect(result.total_cost).toBe(18.5);
    expect(result.estimated_rows).toBe(850);
    expect(result.has_seq_scan).toBe(true);
    expect(result.seq_scan_tables).toContain('customers');
  });

  it('detects no seq scan on index scans', async () => {
    const pool = mockPool([
      'Index Scan using users_pkey on users  (cost=0.29..8.31 rows=1 width=100)',
    ]);

    const result = await estimateQueryCost(pool, 'SELECT * FROM users WHERE id = 1');

    expect(result.has_seq_scan).toBe(false);
    expect(result.seq_scan_tables).toHaveLength(0);
    expect(result.total_cost).toBeCloseTo(8.31);
  });

  it('handles multi-step query plans', async () => {
    const pool = mockPool([
      'Hash Join  (cost=21.50..48.10 rows=850 width=136)',
      '  Hash Cond: (o.customer_id = c.id)',
      '  ->  Seq Scan on orders o  (cost=0.00..18.50 rows=850 width=68)',
      '  ->  Hash  (cost=15.00..15.00 rows=500 width=68)',
      '        ->  Seq Scan on customers c  (cost=0.00..15.00 rows=500 width=68)',
    ]);

    const result = await estimateQueryCost(pool, 'SELECT * FROM orders JOIN customers ON ...');

    expect(result.total_cost).toBeGreaterThan(0);
    expect(result.has_seq_scan).toBe(true);
    expect(result.seq_scan_tables).toContain('orders');
    expect(result.seq_scan_tables).toContain('customers');
  });

  it('returns safe defaults when EXPLAIN fails', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error('DB error')),
    } as unknown as Pool;

    const result = await estimateQueryCost(pool, 'SELECT * FROM users');

    expect(result.total_cost).toBe(0);
    expect(result.has_seq_scan).toBe(false);
    expect(result.plan_summary).toBe('EXPLAIN unavailable');
  });
});

describe('assertCostAcceptable', () => {
  it('does not throw for acceptable cost', () => {
    expect(() =>
      assertCostAcceptable({
        total_cost: 5000,
        has_seq_scan: false,
        seq_scan_tables: [],
        estimated_rows: 100,
        plan_summary: 'Index Scan ...',
      }),
    ).not.toThrow();
  });

  it('throws QUERY_TOO_EXPENSIVE when cost exceeds threshold', () => {
    expect(() =>
      assertCostAcceptable({
        total_cost: 15000,
        has_seq_scan: false,
        seq_scan_tables: [],
        estimated_rows: 100,
        plan_summary: 'Seq Scan ...',
      }),
    ).toThrow(expect.objectContaining({ type: ErrorType.QUERY_TOO_EXPENSIVE }));
  });

  it('throws QUERY_TOO_EXPENSIVE for seq scan on large table', () => {
    expect(() =>
      assertCostAcceptable({
        total_cost: 9000,
        has_seq_scan: true,
        seq_scan_tables: ['large_table'],
        estimated_rows: 200000,
        plan_summary: 'Seq Scan on large_table ...',
      }),
    ).toThrow(expect.objectContaining({ type: ErrorType.QUERY_TOO_EXPENSIVE }));
  });

  it('allows seq scan on small table', () => {
    expect(() =>
      assertCostAcceptable({
        total_cost: 100,
        has_seq_scan: true,
        seq_scan_tables: ['small_table'],
        estimated_rows: 50,
        plan_summary: 'Seq Scan on small_table ...',
      }),
    ).not.toThrow();
  });
});
