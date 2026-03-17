import { validateSql, buildPreviewSql } from './sqlValidator';
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

// ── SELECT — happy paths (READ_ONLY, default) ─────────────────────────────────

describe('validateSql — valid SELECT queries (READ_ONLY)', () => {
  it('accepts a basic SELECT * and returns sql + statementType', () => {
    const result = validateSql('SELECT * FROM users', schema);
    expect(result.sql).toBeTruthy();
    expect(result.statementType).toBe('SELECT');
  });

  it('returns a normalized SQL string', () => {
    const result = validateSql('SELECT * FROM users LIMIT 10', schema);
    expect(typeof result.sql).toBe('string');
    expect(result.sql.length).toBeGreaterThan(0);
  });

  it('accepts SELECT with named columns that exist in schema', () => {
    expect(() => validateSql('SELECT id, name, email FROM users LIMIT 5', schema)).not.toThrow();
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
    expect(result.sql.toUpperCase()).toContain('LIMIT');
  });

  it('preserves an explicit LIMIT lower than 100', () => {
    const result = validateSql('SELECT * FROM users LIMIT 5', schema);
    expect(result.sql).toContain('5');
  });

  it('preserves an explicit LIMIT of exactly 100', () => {
    const result = validateSql('SELECT * FROM users LIMIT 100', schema);
    expect(result.sql).toContain('100');
  });
});

// ── Blocked statement types (READ_ONLY) ──────────────────────────────────────

describe('validateSql — blocked write statements in READ_ONLY mode', () => {
  const writeStatements: Array<[string, string]> = [
    ['DELETE', 'DELETE FROM users WHERE id = 1'],
    ['UPDATE', "UPDATE users SET name = 'x' WHERE id = 1"],
    ['INSERT', "INSERT INTO users (name) VALUES ('x')"],
    ['DROP', 'DROP TABLE users'],
    ['ALTER', 'ALTER TABLE users ADD COLUMN age INT'],
    ['TRUNCATE', 'TRUNCATE TABLE users'],
    ['CREATE', 'CREATE TABLE foo (id INT)'],
  ];

  test.each(writeStatements)('%s is blocked with WRITE_NOT_ALLOWED in READ_ONLY', (_type, sql) => {
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'READ_ONLY');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.WRITE_NOT_ALLOWED);
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

describe('validateSql — table whitelist (READ_ONLY)', () => {
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

describe('validateSql — column whitelist (READ_ONLY)', () => {
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

// ── CRUD_ENABLED — SELECT ─────────────────────────────────────────────────────

describe('validateSql — SELECT in CRUD_ENABLED mode', () => {
  it('accepts SELECT and returns statementType SELECT', () => {
    const result = validateSql('SELECT * FROM users', schema, 'CRUD_ENABLED');
    expect(result.statementType).toBe('SELECT');
    expect(result.sql.toUpperCase()).toContain('LIMIT');
  });
});

// ── CRUD_ENABLED — INSERT ─────────────────────────────────────────────────────

describe('validateSql — INSERT in CRUD_ENABLED mode', () => {
  it('accepts INSERT with explicit column names', () => {
    const sql = "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')";
    const result = validateSql(sql, schema, 'CRUD_ENABLED');
    expect(result.statementType).toBe('INSERT');
    expect(result.sql).toBeTruthy();
  });

  it('throws SCHEMA_VIOLATION for INSERT into unknown table', () => {
    const sql = "INSERT INTO invoices (amount) VALUES (100)";
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.SCHEMA_VIOLATION);
    }
  });

  it('throws SCHEMA_VIOLATION for INSERT with unknown column', () => {
    const sql = "INSERT INTO users (name, nonexistent_col) VALUES ('Alice', 'x')";
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.SCHEMA_VIOLATION);
    }
  });
});

// ── CRUD_ENABLED — UPDATE ─────────────────────────────────────────────────────

describe('validateSql — UPDATE in CRUD_ENABLED mode', () => {
  it('accepts UPDATE with WHERE clause', () => {
    const sql = "UPDATE users SET name = 'Bob' WHERE id = 1";
    const result = validateSql(sql, schema, 'CRUD_ENABLED');
    expect(result.statementType).toBe('UPDATE');
    expect(result.sql).toBeTruthy();
  });

  it('throws MISSING_WHERE_CLAUSE for UPDATE without WHERE', () => {
    const sql = "UPDATE users SET name = 'Bob'";
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.MISSING_WHERE_CLAUSE);
    }
  });

  it('throws SCHEMA_VIOLATION for UPDATE on unknown table', () => {
    const sql = "UPDATE invoices SET amount = 100 WHERE id = 1";
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.SCHEMA_VIOLATION);
    }
  });
});

// ── CRUD_ENABLED — DELETE ─────────────────────────────────────────────────────

describe('validateSql — DELETE in CRUD_ENABLED mode', () => {
  it('accepts DELETE with WHERE clause', () => {
    const sql = 'DELETE FROM users WHERE id = 1';
    const result = validateSql(sql, schema, 'CRUD_ENABLED');
    expect(result.statementType).toBe('DELETE');
    expect(result.sql).toBeTruthy();
  });

  it('throws MISSING_WHERE_CLAUSE for DELETE without WHERE', () => {
    const sql = 'DELETE FROM users';
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.MISSING_WHERE_CLAUSE);
    }
  });

  it('throws SCHEMA_VIOLATION for DELETE on unknown table', () => {
    const sql = 'DELETE FROM invoices WHERE id = 1';
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.SCHEMA_VIOLATION);
    }
  });
});

// ── CRUD_ENABLED — DDL always blocked ────────────────────────────────────────

describe('validateSql — DDL always blocked in CRUD_ENABLED mode', () => {
  const ddlStatements: Array<[string, string]> = [
    ['DROP', 'DROP TABLE users'],
    ['ALTER', 'ALTER TABLE users ADD COLUMN age INT'],
    ['TRUNCATE', 'TRUNCATE TABLE users'],
    ['CREATE', 'CREATE TABLE foo (id INT)'],
  ];

  test.each(ddlStatements)('%s is blocked with WRITE_NOT_ALLOWED in CRUD_ENABLED', (_type, sql) => {
    expect.assertions(2);
    try {
      validateSql(sql, schema, 'CRUD_ENABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.WRITE_NOT_ALLOWED);
    }
  });
});

// ── buildPreviewSql ───────────────────────────────────────────────────────────

describe('buildPreviewSql', () => {
  it('converts DELETE ... WHERE into SELECT * FROM table WHERE ... LIMIT 10', () => {
    const sql = 'DELETE FROM users WHERE id = 1';
    const preview = buildPreviewSql(sql);
    expect(preview.toUpperCase()).toContain('SELECT');
    expect(preview.toLowerCase()).toContain('users');
    expect(preview.toUpperCase()).toContain('LIMIT');
    expect(preview.toUpperCase()).not.toContain('DELETE');
  });

  it('converts UPDATE ... SET ... WHERE into SELECT * FROM table WHERE ... LIMIT 10', () => {
    const sql = "UPDATE users SET name = 'Bob' WHERE id = 1";
    const preview = buildPreviewSql(sql);
    expect(preview.toUpperCase()).toContain('SELECT');
    expect(preview.toLowerCase()).toContain('users');
    expect(preview.toUpperCase()).toContain('LIMIT');
    expect(preview.toUpperCase()).not.toContain('UPDATE');
  });

  it('preserves the WHERE condition in the preview SELECT', () => {
    const sql = 'DELETE FROM users WHERE id = 42';
    const preview = buildPreviewSql(sql);
    expect(preview).toContain('42');
  });

  it('throws when called with a SELECT statement', () => {
    expect(() => buildPreviewSql('SELECT * FROM users')).toThrow();
  });
});
