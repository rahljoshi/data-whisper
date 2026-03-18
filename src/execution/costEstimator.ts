import type { Pool } from 'pg';
import { AppError, ErrorType } from '../types/errors';
import { config } from '../config';

export interface CostEstimation {
  total_cost: number;
  has_seq_scan: boolean;
  seq_scan_tables: string[];
  estimated_rows: number;
  plan_summary: string;
}

interface ExplainRow {
  'QUERY PLAN': string;
}

/**
 * Parse a single EXPLAIN output line to extract cost and row count.
 * Example: "Seq Scan on customers  (cost=0.00..18.50 rows=850 width=68)"
 */
function parsePlanLine(line: string): {
  cost: number | null;
  rows: number | null;
  isSeqScan: boolean;
  tableName: string | null;
} {
  const costMatch = /cost=[\d.]+\.\.([\d.]+)/.exec(line);
  const rowsMatch = /rows=(\d+)/.exec(line);
  const seqScanMatch = /Seq Scan on (\w+)/i.exec(line);

  return {
    cost: costMatch ? parseFloat(costMatch[1]) : null,
    rows: rowsMatch ? parseInt(rowsMatch[1], 10) : null,
    isSeqScan: seqScanMatch !== null,
    tableName: seqScanMatch ? seqScanMatch[1] : null,
  };
}

/**
 * Run EXPLAIN (not ANALYZE) on a SELECT query and return cost estimation.
 * Never throws for estimation failures — returns a safe default.
 */
export async function estimateQueryCost(
  pool: Pool,
  sql: string,
): Promise<CostEstimation> {
  try {
    const result = await pool.query<ExplainRow>(`EXPLAIN ${sql}`);
    const planLines = result.rows.map((r) => r['QUERY PLAN']);

    let maxCost = 0;
    let totalRows = 0;
    let hasSeqScan = false;
    const seqScanTables: string[] = [];

    for (const line of planLines) {
      const parsed = parsePlanLine(line);
      if (parsed.cost !== null && parsed.cost > maxCost) {
        maxCost = parsed.cost;
      }
      if (parsed.rows !== null) {
        totalRows = Math.max(totalRows, parsed.rows);
      }
      if (parsed.isSeqScan && parsed.tableName) {
        hasSeqScan = true;
        if (!seqScanTables.includes(parsed.tableName)) {
          seqScanTables.push(parsed.tableName);
        }
      }
    }

    return {
      total_cost: maxCost,
      has_seq_scan: hasSeqScan,
      seq_scan_tables: seqScanTables,
      estimated_rows: totalRows,
      plan_summary: planLines.slice(0, 3).join(' | '),
    };
  } catch {
    return {
      total_cost: 0,
      has_seq_scan: false,
      seq_scan_tables: [],
      estimated_rows: 0,
      plan_summary: 'EXPLAIN unavailable',
    };
  }
}

/**
 * Check if the estimated cost exceeds configured thresholds.
 * Throws QUERY_TOO_EXPENSIVE if the query is rejected.
 */
export function assertCostAcceptable(estimation: CostEstimation): void {
  const { queryCostThreshold, seqScanRowThreshold } = config.costEstimation;

  if (estimation.total_cost > queryCostThreshold) {
    throw new AppError(
      ErrorType.QUERY_TOO_EXPENSIVE,
      `Query cost (${estimation.total_cost.toFixed(2)}) exceeds the allowed threshold (${queryCostThreshold}).`,
    );
  }

  if (estimation.has_seq_scan && estimation.estimated_rows > seqScanRowThreshold) {
    throw new AppError(
      ErrorType.QUERY_TOO_EXPENSIVE,
      `Sequential scan detected on a large table (estimated ${estimation.estimated_rows} rows, threshold ${seqScanRowThreshold}).`,
    );
  }
}
