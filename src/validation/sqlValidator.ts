import { Parser } from 'node-sql-parser';
import type { AST, Select, Column, From } from 'node-sql-parser';
import { AppError, ErrorType } from '../types/errors';
import type { DbSchema } from '../types/schema';
import type { QueryMode } from '../types/api';
import { config } from '../config';

const parser = new Parser();

/** Statement types that are never allowed regardless of mode. */
const DDL_BLOCKED = new Set(['drop', 'alter', 'truncate', 'create', 'rename', 'replace', 'merge', 'call', 'grant', 'revoke']);

/** Statement types allowed only in CRUD_ENABLED mode (in addition to SELECT). */
const CRUD_WRITE_TYPES = new Set(['insert', 'update', 'delete']);

export interface SqlValidationResult {
  sql: string;
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}

/**
 * Resolve a table name to its canonical qualified key in the schema.
 * Accepts both "table" and "schema.table" forms.
 */
function resolveTableKey(name: string, schema: DbSchema): string | null {
  if (schema.has(name)) return name;
  for (const dbSchema of config.db.schemas) {
    const qualified = `${dbSchema}.${name}`;
    if (schema.has(qualified)) return qualified;
  }
  return null;
}

/**
 * Extract all table names referenced in the AST FROM / JOIN clauses.
 */
function extractTableNames(ast: Select): string[] {
  const tables: string[] = [];

  function walkFrom(from: From[] | null | undefined): void {
    if (!from) return;
    for (const item of from) {
      if ('table' in item && typeof item.table === 'string') {
        tables.push(item.table);
      }
    }
  }

  walkFrom(ast.from as From[] | null);
  return tables;
}

/**
 * Extract all explicitly named columns from the SELECT list.
 * Wildcard (*) columns are skipped — they are always allowed.
 */
function extractColumnNames(ast: Select): Array<{ table: string | null; column: string }> {
  const columns: Array<{ table: string | null; column: string }> = [];

  if (!Array.isArray(ast.columns)) return columns;

  for (const item of ast.columns as Column[]) {
    if (item.expr?.type === 'column_ref') {
      const col = item.expr.column;
      const tbl = item.expr.table ?? null;
      if (col && col !== '*') {
        columns.push({ table: tbl, column: col });
      }
    }
  }

  return columns;
}

/**
 * Inject LIMIT {maxRows} into the AST if no LIMIT clause is present.
 *
 * node-sql-parser always sets ast.limit = { seperator: '', value: [] }
 * even when no LIMIT clause exists — so we check for an empty value array.
 */
function injectLimit(ast: Select, maxRows: number): void {
  const hasLimit =
    ast.limit != null &&
    Array.isArray((ast.limit as { value?: unknown[] }).value) &&
    (ast.limit as { value: unknown[] }).value.length > 0;

  if (!hasLimit) {
    ast.limit = {
      seperator: '',
      value: [{ type: 'number', value: maxRows }],
    };
  }
}

/** Validate all table names against the schema; throws with the given error type on mismatch. */
function validateTables(
  tableNames: string[],
  schema: DbSchema,
  errorType: ErrorType,
): void {
  for (const tableName of tableNames) {
    const key = resolveTableKey(tableName, schema);
    if (!key) {
      throw new AppError(errorType, `Table "${tableName}" does not exist in the database schema`);
    }
  }
}

/** Validate SELECT column refs against the schema. */
function validateSelectColumns(
  selectAst: Select,
  tableNames: string[],
  schema: DbSchema,
  errorType: ErrorType,
): void {
  const columnRefs = extractColumnNames(selectAst);
  for (const { table: refTable, column: colName } of columnRefs) {
    if (refTable) {
      const key = resolveTableKey(refTable, schema);
      if (!key) {
        throw new AppError(
          errorType,
          `Table "${refTable}" referenced in column "${refTable}.${colName}" does not exist in the schema`,
        );
      }
      const tableInfo = schema.get(key)!;
      if (!tableInfo.columns.has(colName)) {
        throw new AppError(errorType, `Column "${colName}" does not exist in table "${refTable}"`);
      }
    } else {
      if (tableNames.length > 0) {
        const existsInAny = tableNames.some((tbl) => {
          const key = resolveTableKey(tbl, schema);
          if (!key) return false;
          return schema.get(key)!.columns.has(colName);
        });
        if (!existsInAny) {
          throw new AppError(
            errorType,
            `Column "${colName}" does not exist in any of the queried tables`,
          );
        }
      }
    }
  }
}

/** Validate INSERT columns against the schema. */
function validateInsertColumns(
  stmt: AST,
  schema: DbSchema,
): void {
  const ins = stmt as unknown as {
    table: Array<{ table: string }>;
    columns: string[] | null;
  };

  const tableName = ins.table?.[0]?.table;
  if (!tableName) return;

  const key = resolveTableKey(tableName, schema);
  if (!key) {
    throw new AppError(
      ErrorType.SCHEMA_VIOLATION,
      `Table "${tableName}" does not exist in the database schema`,
    );
  }

  const tableInfo = schema.get(key)!;
  const insertCols = ins.columns;

  if (Array.isArray(insertCols)) {
    for (const col of insertCols) {
      if (!tableInfo.columns.has(col)) {
        throw new AppError(
          ErrorType.SCHEMA_VIOLATION,
          `Column "${col}" does not exist in table "${tableName}"`,
        );
      }
    }
  }
}

/** Validate UPDATE table against the schema and enforce WHERE. */
function validateUpdate(stmt: AST, schema: DbSchema): void {
  const upd = stmt as unknown as {
    table: Array<{ table: string }>;
    where: unknown;
  };

  if (!upd.where) {
    throw new AppError(
      ErrorType.MISSING_WHERE_CLAUSE,
      'UPDATE statement must include a WHERE clause to prevent unintended full-table updates',
    );
  }

  const tableName = upd.table?.[0]?.table;
  if (tableName) {
    const key = resolveTableKey(tableName, schema);
    if (!key) {
      throw new AppError(
        ErrorType.SCHEMA_VIOLATION,
        `Table "${tableName}" does not exist in the database schema`,
      );
    }
  }
}

/** Validate DELETE table against the schema and enforce WHERE. */
function validateDelete(stmt: AST, schema: DbSchema): void {
  const del = stmt as unknown as {
    from: Array<{ table: string }>;
    where: unknown;
  };

  if (!del.where) {
    throw new AppError(
      ErrorType.MISSING_WHERE_CLAUSE,
      'DELETE statement must include a WHERE clause to prevent unintended full-table deletions',
    );
  }

  const tableName = del.from?.[0]?.table;
  if (tableName) {
    const key = resolveTableKey(tableName, schema);
    if (!key) {
      throw new AppError(
        ErrorType.SCHEMA_VIOLATION,
        `Table "${tableName}" does not exist in the database schema`,
      );
    }
  }
}

/**
 * Build a preview SELECT query from a validated UPDATE or DELETE statement.
 * The result is a `SELECT * FROM <table> WHERE <condition> LIMIT 10` query
 * that can be executed as a dry-run to show what would be affected.
 */
export function buildPreviewSql(validatedSql: string): string {
  let ast: AST | AST[];

  try {
    ast = parser.astify(validatedSql, { database: 'PostgreSQL' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`buildPreviewSql: failed to parse SQL: ${msg}`);
  }

  const stmt = Array.isArray(ast) ? ast[0] : ast;
  if (!stmt) throw new Error('buildPreviewSql: no AST produced');

  const stmtType = stmt.type?.toLowerCase();

  if (stmtType === 'delete') {
    const del = stmt as unknown as { from: Array<{ table: string }>; where: unknown };
    const tableName = del.from?.[0]?.table;
    if (!tableName) throw new Error('buildPreviewSql: could not extract table from DELETE');

    const selectAst = {
      type: 'select',
      columns: '*',
      from: [{ table: tableName, db: null, as: null }],
      where: del.where ?? null,
      limit: { seperator: '', value: [{ type: 'number', value: 10 }] },
    };
    return parser.sqlify(selectAst as unknown as AST, { database: 'PostgreSQL' });
  }

  if (stmtType === 'update') {
    const upd = stmt as unknown as { table: Array<{ table: string }>; where: unknown };
    const tableName = upd.table?.[0]?.table;
    if (!tableName) throw new Error('buildPreviewSql: could not extract table from UPDATE');

    const selectAst = {
      type: 'select',
      columns: '*',
      from: [{ table: tableName, db: null, as: null }],
      where: upd.where ?? null,
      limit: { seperator: '', value: [{ type: 'number', value: 10 }] },
    };
    return parser.sqlify(selectAst as unknown as AST, { database: 'PostgreSQL' });
  }

  throw new Error(`buildPreviewSql: expected UPDATE or DELETE statement, got "${stmtType}"`);
}

/**
 * Parse, validate, and normalize a SQL string.
 *
 * In READ_ONLY mode (default):
 * - Only SELECT is allowed; anything else throws WRITE_NOT_ALLOWED.
 * - Unknown tables/columns throw SCHEMA_MISMATCH.
 * - LIMIT is injected if absent.
 *
 * In CRUD_ENABLED mode:
 * - SELECT, INSERT, UPDATE, DELETE are allowed.
 * - DDL (DROP, ALTER, TRUNCATE, etc.) throws WRITE_NOT_ALLOWED.
 * - UPDATE/DELETE without WHERE throws MISSING_WHERE_CLAUSE.
 * - Unknown tables/columns throw SCHEMA_VIOLATION.
 * - SELECT auto-injects LIMIT.
 *
 * Returns a SqlValidationResult with the normalized SQL and statementType.
 * Throws AppError on any violation.
 */
export function validateSql(
  rawSql: string,
  schema: DbSchema,
  mode: QueryMode = 'READ_ONLY',
): SqlValidationResult {
  let ast: AST | AST[];

  try {
    ast = parser.astify(rawSql, { database: 'PostgreSQL' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(ErrorType.INVALID_SQL, `SQL parse error: ${msg}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];

  if (statements.length === 0) {
    throw new AppError(ErrorType.AMBIGUOUS_QUERY, 'No SQL statement was generated');
  }

  if (statements.length > 1) {
    throw new AppError(
      ErrorType.INVALID_SQL,
      'Only a single SQL statement is allowed; multiple statements were detected',
    );
  }

  const stmt = statements[0]!;
  const stmtType = stmt.type?.toLowerCase() ?? '';

  // DDL is always blocked regardless of mode
  if (DDL_BLOCKED.has(stmtType)) {
    throw new AppError(
      ErrorType.WRITE_NOT_ALLOWED,
      `Statement type "${stmtType.toUpperCase()}" is not allowed`,
    );
  }

  if (mode === 'READ_ONLY') {
    if (stmtType !== 'select') {
      throw new AppError(
        ErrorType.WRITE_NOT_ALLOWED,
        `Statement type "${stmtType.toUpperCase()}" is not allowed in READ_ONLY mode. Only SELECT queries are permitted.`,
      );
    }
  } else {
    // CRUD_ENABLED: allow SELECT + write types, reject anything else
    if (stmtType !== 'select' && !CRUD_WRITE_TYPES.has(stmtType)) {
      throw new AppError(
        ErrorType.WRITE_NOT_ALLOWED,
        `Unrecognized or disallowed statement type: "${stmtType}"`,
      );
    }
  }

  // ── Mode-specific validation ──────────────────────────────────────────────

  if (stmtType === 'select') {
    const selectAst = stmt as Select;
    const tableNames = extractTableNames(selectAst);
    validateTables(tableNames, schema, ErrorType.SCHEMA_MISMATCH);
    validateSelectColumns(selectAst, tableNames, schema, ErrorType.SCHEMA_MISMATCH);
    injectLimit(selectAst, config.query.maxRows);
    const sql = parser.sqlify(selectAst, { database: 'PostgreSQL' });
    return { sql, statementType: 'SELECT' };
  }

  if (stmtType === 'insert') {
    validateInsertColumns(stmt, schema);
    const sql = parser.sqlify(stmt, { database: 'PostgreSQL' });
    return { sql, statementType: 'INSERT' };
  }

  if (stmtType === 'update') {
    validateUpdate(stmt, schema);
    const sql = parser.sqlify(stmt, { database: 'PostgreSQL' });
    return { sql, statementType: 'UPDATE' };
  }

  if (stmtType === 'delete') {
    validateDelete(stmt, schema);
    const sql = parser.sqlify(stmt, { database: 'PostgreSQL' });
    return { sql, statementType: 'DELETE' };
  }

  throw new AppError(ErrorType.INVALID_SQL, `Unrecognized statement type: "${stmtType}"`);
}
