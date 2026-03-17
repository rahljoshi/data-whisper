import { Parser } from 'node-sql-parser';
import type { AST, Select, Column, From } from 'node-sql-parser';
import { AppError, ErrorType } from '../types/errors';
import type { DbSchema } from '../types/schema';
import { config } from '../config';

const parser = new Parser();

const ALLOWED_STATEMENT_TYPES = new Set(['select']);

const BLOCKED_STATEMENT_TYPES = new Set([
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'truncate',
  'create',
  'rename',
  'replace',
  'merge',
  'call',
  'grant',
  'revoke',
]);

/**
 * Resolve a table name to its canonical qualified key in the schema.
 * Accepts both "table" and "schema.table" forms.
 */
function resolveTableKey(name: string, schema: DbSchema): string | null {
  if (schema.has(name)) return name;
  // Try qualifying with default schemas
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

/**
 * Parse, validate, and normalize a SQL string.
 *
 * - Asserts that exactly one SELECT statement is present.
 * - Validates all referenced tables against the DbSchema whitelist.
 * - Validates explicitly named columns against the DbSchema whitelist.
 * - Injects LIMIT if absent.
 * - Returns the normalized SQL string.
 *
 * Throws AppError on any violation.
 */
export function validateSql(rawSql: string, schema: DbSchema): string {
  let ast: AST | AST[];

  try {
    ast = parser.astify(rawSql, { database: 'PostgreSQL' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(ErrorType.INVALID_SQL, `SQL parse error: ${msg}`);
  }

  // Normalize to array and reject multi-statement SQL
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

  if (BLOCKED_STATEMENT_TYPES.has(stmtType)) {
    throw new AppError(
      ErrorType.INVALID_SQL,
      `Statement type "${stmtType.toUpperCase()}" is not allowed. Only SELECT queries are permitted.`,
    );
  }

  if (!ALLOWED_STATEMENT_TYPES.has(stmtType)) {
    throw new AppError(
      ErrorType.INVALID_SQL,
      `Unrecognized or disallowed statement type: "${stmtType}"`,
    );
  }

  const selectAst = stmt as Select;

  // Validate table references
  const tableNames = extractTableNames(selectAst);
  for (const tableName of tableNames) {
    const key = resolveTableKey(tableName, schema);
    if (!key) {
      throw new AppError(
        ErrorType.SCHEMA_MISMATCH,
        `Table "${tableName}" does not exist in the database schema`,
      );
    }
  }

  // Validate column references (skip wildcards, expressions, aggregates)
  const columnRefs = extractColumnNames(selectAst);
  for (const { table: refTable, column: colName } of columnRefs) {
    if (refTable) {
      // Column qualified with a table name — look up that specific table
      const key = resolveTableKey(refTable, schema);
      if (!key) {
        throw new AppError(
          ErrorType.SCHEMA_MISMATCH,
          `Table "${refTable}" referenced in column "${refTable}.${colName}" does not exist in the schema`,
        );
      }
      const tableInfo = schema.get(key)!;
      if (!tableInfo.columns.has(colName)) {
        throw new AppError(
          ErrorType.SCHEMA_MISMATCH,
          `Column "${colName}" does not exist in table "${refTable}"`,
        );
      }
    } else {
      // Unqualified column — check that it exists in at least one of the queried tables
      if (tableNames.length > 0) {
        const existsInAny = tableNames.some((tbl) => {
          const key = resolveTableKey(tbl, schema);
          if (!key) return false;
          return schema.get(key)!.columns.has(colName);
        });
        if (!existsInAny) {
          throw new AppError(
            ErrorType.SCHEMA_MISMATCH,
            `Column "${colName}" does not exist in any of the queried tables`,
          );
        }
      }
    }
  }

  // Inject LIMIT if missing
  injectLimit(selectAst, config.query.maxRows);

  // Re-serialize the AST back to SQL
  const normalizedSql = parser.sqlify(selectAst, { database: 'PostgreSQL' });

  return normalizedSql;
}
