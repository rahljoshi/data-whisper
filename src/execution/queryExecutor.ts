import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { AppError, ErrorType } from '../types/errors';

let pool: Pool | null = null;

function buildPoolConfig() {
  if (config.db.connectionString) {
    return {
      connectionString: config.db.connectionString,
      max: config.db.poolMax,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    };
  }
  return {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.db.poolMax,
    idleTimeoutMillis: config.db.idleTimeoutMillis,
    connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig());

    pool.on('error', (err) => {
      console.error('[QueryExecutor] Idle pool client error:', err.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Execute a pre-validated SQL SELECT query with a hard timeout.
 *
 * Acquires a dedicated client from the pool to support session-level
 * statement_timeout. The client is always released in the finally block.
 */
export async function executeQuery(sql: string): Promise<QueryResult> {
  const pg = getPool();
  let client: PoolClient | null = null;

  const timeoutMs = config.query.timeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new AppError(ErrorType.TIMEOUT, `Query exceeded the ${timeoutMs}ms time limit`)),
      timeoutMs,
    ),
  );

  const queryPromise = async (): Promise<QueryResult> => {
    client = await pg.connect();

    // Set a session-level statement timeout as a second line of defense
    await client.query(`SET statement_timeout = ${timeoutMs}`);

    const result = await client.query(sql);

    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  };

  try {
    return await Promise.race([queryPromise(), timeoutPromise]);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(ErrorType.EXECUTION_ERROR, `Database query failed: ${message}`);
  } finally {
    if (client) {
      (client as PoolClient).release();
    }
  }
}

/**
 * Test that the pool can acquire a connection and run a trivial query.
 */
export async function testConnection(): Promise<void> {
  const pg = getPool();
  const client = await pg.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
