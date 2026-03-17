import { createHash } from 'crypto';
import { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { config } from '../config';
import type { ColumnInfo, DbSchema, SchemaSnapshot, TableInfo } from '../types/schema';

const REDIS_SCHEMA_KEY = 'data-whisper:schema';
const REDIS_SCHEMA_TTL = 600; // 10 minutes

let snapshot: SchemaSnapshot | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Serialize DbSchema to a JSON-safe structure for Redis storage.
 */
function serializeSchema(schema: DbSchema): string {
  const obj: Record<string, { schema: string; tableName: string; columns: Record<string, ColumnInfo> }> = {};
  for (const [key, tableInfo] of schema.entries()) {
    obj[key] = {
      schema: tableInfo.schema,
      tableName: tableInfo.tableName,
      columns: Object.fromEntries(tableInfo.columns.entries()),
    };
  }
  return JSON.stringify(obj);
}

/**
 * Deserialize schema from Redis-stored JSON.
 */
function deserializeSchema(raw: string): DbSchema {
  const obj = JSON.parse(raw) as Record<
    string,
    { schema: string; tableName: string; columns: Record<string, ColumnInfo> }
  >;
  const schema: DbSchema = new Map();
  for (const [key, value] of Object.entries(obj)) {
    schema.set(key, {
      schema: value.schema,
      tableName: value.tableName,
      columns: new Map(Object.entries(value.columns)),
    });
  }
  return schema;
}

/**
 * Compute a stable SHA-256 hash of the schema for cache key versioning.
 */
function computeSchemaVersion(schema: DbSchema): string {
  const keys: string[] = [];
  for (const [tableKey, tableInfo] of schema.entries()) {
    for (const colName of tableInfo.columns.keys()) {
      keys.push(`${tableKey}.${colName}`);
    }
  }
  keys.sort();
  return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 16);
}

/**
 * Introspect tables and columns from information_schema for configured schemas.
 */
async function introspectDatabase(pool: Pool): Promise<DbSchema> {
  const schemaPlaceholders = config.db.schemas.map((_, i) => `$${i + 1}`).join(', ');

  const tablesResult = await pool.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN (${schemaPlaceholders})
       AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`,
    config.db.schemas,
  );

  if (tablesResult.rows.length === 0) {
    return new Map();
  }

  const columnsResult = await pool.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema IN (${schemaPlaceholders})
     ORDER BY table_schema, table_name, ordinal_position`,
    config.db.schemas,
  );

  const schema: DbSchema = new Map();

  for (const row of tablesResult.rows) {
    const qualifiedKey = `${row.table_schema}.${row.table_name}`;
    const tableInfo: TableInfo = {
      schema: row.table_schema,
      tableName: row.table_name,
      columns: new Map(),
    };
    schema.set(qualifiedKey, tableInfo);

    // Also index by plain table name for single-schema convenience
    if (!schema.has(row.table_name)) {
      schema.set(row.table_name, tableInfo);
    }
  }

  for (const row of columnsResult.rows) {
    const qualifiedKey = `${row.table_schema}.${row.table_name}`;
    const tableInfo = schema.get(qualifiedKey);
    if (tableInfo) {
      tableInfo.columns.set(row.column_name, {
        columnName: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        columnDefault: row.column_default,
      });
    }
  }

  return schema;
}

/**
 * Load schema: first try Redis cache, then introspect DB.
 */
export async function loadSchema(pool: Pool, redis: Redis | null): Promise<void> {
  if (redis) {
    try {
      const cached = await redis.get(REDIS_SCHEMA_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { schema: string; version: string };
        const schema = deserializeSchema(parsed.schema);
        snapshot = { schema, version: parsed.version, loadedAt: new Date() };
        return;
      }
    } catch {
      // Redis unavailable — fall through to DB introspection
    }
  }

  await refreshSchemaFromDb(pool, redis);
}

/**
 * Force-reload schema from the database and update Redis cache.
 */
export async function refreshSchemaFromDb(pool: Pool, redis: Redis | null): Promise<void> {
  const schema = await introspectDatabase(pool);
  const version = computeSchemaVersion(schema);
  snapshot = { schema, version, loadedAt: new Date() };

  if (redis) {
    try {
      await redis.set(
        REDIS_SCHEMA_KEY,
        JSON.stringify({ schema: serializeSchema(schema), version }),
        'EX',
        REDIS_SCHEMA_TTL,
      );
    } catch {
      // Non-fatal: continue without caching
    }
  }
}

/**
 * Start a periodic refresh timer.
 */
export function startSchemaRefreshTimer(pool: Pool, redis: Redis | null): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshSchemaFromDb(pool, redis).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SchemaService] Background refresh failed: ${message}`);
    });
  }, config.query.schemaRefreshIntervalMs);
}

/**
 * Stop the refresh timer (used during graceful shutdown).
 */
export function stopSchemaRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getSchema(): DbSchema {
  if (!snapshot) {
    throw new Error('Schema not loaded. Call loadSchema() during server startup.');
  }
  return snapshot.schema;
}

export function getSchemaVersion(): string {
  if (!snapshot) {
    throw new Error('Schema not loaded. Call loadSchema() during server startup.');
  }
  return snapshot.version;
}

export function getSchemaSnapshot(): SchemaSnapshot {
  if (!snapshot) {
    throw new Error('Schema not loaded. Call loadSchema() during server startup.');
  }
  return snapshot;
}

/**
 * Serialize DbSchema to a compact DDL-like string for the LLM prompt.
 * Sensitive columns are omitted based on config.security.sensitiveColumnPatterns.
 */
export function schemaToPromptString(schema: DbSchema): string {
  const sensitivePatterns = config.security.sensitiveColumnPatterns;
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const [_key, tableInfo] of schema.entries()) {
    const qualifiedKey = `${tableInfo.schema}.${tableInfo.tableName}`;
    if (seen.has(qualifiedKey)) continue;
    seen.add(qualifiedKey);

    const columns: string[] = [];
    for (const col of tableInfo.columns.values()) {
      const nameLower = col.columnName.toLowerCase();
      const isSensitive = sensitivePatterns.some(
        (pattern) => nameLower === pattern || nameLower.includes(pattern),
      );
      if (isSensitive) continue;

      const nullable = col.isNullable ? '' : ' NOT NULL';
      columns.push(`  ${col.columnName} ${col.dataType}${nullable}`);
    }

    if (columns.length === 0) continue;

    lines.push(`TABLE ${tableInfo.tableName} (`);
    lines.push(columns.join(',\n'));
    lines.push(');');
    lines.push('');
  }

  return lines.join('\n');
}
