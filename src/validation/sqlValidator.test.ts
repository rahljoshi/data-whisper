import { validateSql } from './sqlValidator';
import { AppError, ErrorType } from '../types/errors';
import type { DbSchema, TableInfo } from '../types/schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSchema(
  tables: Record<string, string[]>,
  schemaName = 'public',
): DbSchema {
  const schema: DbSchema = new Map();

  for (const [tableName, columns] of Object.entries(tables)) {
    const tableInfo: TableInfo = {
      schema: schemaName,
      tableName,
      columns: new Map(
        columns.map((col) => [
          col,
          { columnName: col, dataType: 'text', isNullable: true, columnDefault: null },
        ]),
      ),
    };
    schema.set(tableName, tableInfo);
    schema.set(`${schemaName}.${tableName}`, tableInfo);
  }

  return schema;
}

const schema = makeSchema({
  users: ['id', 'name', 'email', 'created_at'],
  orders: ['id', 'user_id', 'total', 'status', 'created_at'],
});

// ── SELECT — happy paths ─────────────────────────────────────────────────────

describe('validateSql — valid SELECT queries', () => {
  it('accepts a basic SELECT *', () => {
    const sql = 'SELECT * FROM users';
    expect(() => validateSql(sql, schema)).not.toThrow();
  });

  it('returns a string (normalized SQL)', () => {
    const result = validateSql('SELECT * FROM users LIMIT 10', schema);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('accepts SELECT with named columns that exist in schema', () => {
    const sql = 'SELECT id, name, email FROM users LIMIT 5';
    expect(() => validateSql(sql, schema)).not.toThrow();
  });

  it('accepts a JOIN across two known tables', () => {
    const sql =
      'SELECT users.name, orders.total FROM users JOIN orders ON users.id = orders.user_id LIMIT 10';
    expect(() => validateSql(sql, schema)).not.toThrow();
  });

  it('accepts SELECT with WHERE clause', () => {
    const sql = "SELECT * FROM orders WHERE status = 'active' LIMIT 20";
    expect(() => validateSql(sql, schema)).not.toThrow();
  });

  it('accepts aggregate functions (COUNT, SUM)', () => {
    const sql = 'SELECT COUNT(*) FROM orders';
    expect(() => validateSql(sql, schema)).not.toThrow();
  });
});

// ── LIMIT injection ───────────────────────────────────────────────────────────

describe('validateSql — LIMIT injection', () => {
  it('injects LIMIT 100 when no LIMIT clause is present', () => {
    const result = validateSql('SELECT * FROM users', schema);
    expect(result.toUpperCase()).toContain('LIMIT');
  });

  it('preserves an explicit LIMIT lower than 100', () => {
    const result = validateSql('SELECT * FROM users LIMIT 5', schema);
    expect(result).toContain('5');
  });

  it('preserves an explicit LIMIT of exactly 100', () => {
    const result = validateSql('SELECT * FROM users LIMIT 100', schema);
    expect(result).toContain('100');
  });
});

// ── Blocked statement types ───────────────────────────────────────────────────

describe('validateSql — blocked statement types', () => {
  const blockedStatements: Array<[string, string]> = [
    ['DELETE', 'DELETE FROM users WHERE id = 1'],
    ['UPDATE', "UPDATE users SET name = 'x' WHERE id = 1"],
    ['INSERT', "INSERT INTO users (name) VALUES ('x')"],
    ['DROP', 'DROP TABLE users'],
    ['ALTER', 'ALTER TABLE users ADD COLUMN age INT'],
    ['TRUNCATE', 'TRUNCATE TABLE users'],
    ['CREATE', 'CREATE TABLE foo (id INT)'],
  ];

  test.each(blockedStatements)('%s is blocked with INVALID_SQL', (_type, sql) => {
    expect(() => validateSql(sql, schema)).toThrow(AppError);

    try {
      validateSql(sql, schema);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.INVALID_SQL);
    }
  });
});

// ── Multi-statement SQL ───────────────────────────────────────────────────────

describe('validateSql — multi-statement SQL', () => {
  it('rejects two SELECT statements separated by semicolon', () => {
    expect(() =>
      validateSql('SELECT * FROM users; SELECT * FROM orders', schema),
    ).toThrow(AppError);
  });
});

// ── Schema whitelist — tables ─────────────────────────────────────────────────

describe('validateSql — table whitelist', () => {
  it('throws SCHEMA_MISMATCH for an unknown table', () => {
    const sql = 'SELECT * FROM nonexistent_table LIMIT 10';
    let caught: unknown;
    try {
      validateSql(sql, schema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).type).toBe(ErrorType.SCHEMA_MISMATCH);
  });

  it('error message includes the unknown table name', () => {
    const sql = 'SELECT * FROM invoices LIMIT 10';
    expect.assertions(1);
    try {
      validateSql(sql, schema);
    } catch (err) {
      expect((err as AppError).message).toContain('invoices');
    }
  });
});

// ── Schema whitelist — columns ────────────────────────────────────────────────

describe('validateSql — column whitelist', () => {
  it('throws SCHEMA_MISMATCH for a column that does not exist in the table', () => {
    const sql = 'SELECT id, nonexistent_column FROM users LIMIT 10';
    let caught: unknown;
    try {
      validateSql(sql, schema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).type).toBe(ErrorType.SCHEMA_MISMATCH);
  });

  it('allows wildcard SELECT * without column validation', () => {
    expect(() => validateSql('SELECT * FROM users LIMIT 5', schema)).not.toThrow();
  });

  it('allows table-qualified column references that exist', () => {
    expect(() =>
      validateSql('SELECT users.id, users.name FROM users LIMIT 5', schema),
    ).not.toThrow();
  });

  it('throws SCHEMA_MISMATCH for a table-qualified column that does not exist', () => {
    const sql = 'SELECT users.ghost_column FROM users LIMIT 5';
    expect.assertions(1);
    try {
      validateSql(sql, schema);
    } catch (err) {
      expect((err as AppError).type).toBe(ErrorType.SCHEMA_MISMATCH);
    }
  });
});

// ── Unparseable SQL ───────────────────────────────────────────────────────────

describe('validateSql — unparseable input', () => {
  it('throws INVALID_SQL for completely non-SQL text', () => {
    let caught: unknown;
    try {
      validateSql('this is not sql at all @@##', schema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).type).toBe(ErrorType.INVALID_SQL);
  });
});
