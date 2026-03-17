/**
 * Route tests for POST /api/query.
 * All external modules are mocked at the boundary.
 */

jest.mock('../../ai/sqlGenerator');
jest.mock('../../ai/sqlExplainer');
jest.mock('../../validation/sqlValidator');
jest.mock('../../execution/queryExecutor');
jest.mock('../../cache/cacheService');
jest.mock('../../schema/schemaService');
jest.mock('../../utils/sqlFormatter');

import Fastify from 'fastify';
import { queryRoutes } from './query.route';
import { generateSql } from '../../ai/sqlGenerator';
import { explainSql } from '../../ai/sqlExplainer';
import { validateSql, buildPreviewSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import type { DbSchema } from '../../types/schema';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockGenerateSql = generateSql as jest.MockedFunction<typeof generateSql>;
const mockExplainSql = explainSql as jest.MockedFunction<typeof explainSql>;
const mockValidateSql = validateSql as jest.MockedFunction<typeof validateSql>;
const mockBuildPreviewSql = buildPreviewSql as jest.MockedFunction<typeof buildPreviewSql>;
const mockExecuteQuery = executeQuery as jest.MockedFunction<typeof executeQuery>;
const mockGetCachedResult = getCachedResult as jest.MockedFunction<typeof getCachedResult>;
const mockSetCachedResult = setCachedResult as jest.MockedFunction<typeof setCachedResult>;
const mockGetSchema = getSchema as jest.MockedFunction<typeof getSchema>;
const mockGetSchemaVersion = getSchemaVersion as jest.MockedFunction<typeof getSchemaVersion>;
const mockFormatSql = formatSql as jest.MockedFunction<typeof formatSql>;

// ── Test setup ────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(queryRoutes, { redis: null });
  await app.ready();
  return app;
}

const fakeSchema = new Map() as DbSchema;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSchema.mockReturnValue(fakeSchema);
  mockGetSchemaVersion.mockReturnValue('v1');
  mockGetCachedResult.mockResolvedValue(null);
  mockSetCachedResult.mockResolvedValue(undefined);
  mockFormatSql.mockImplementation((sql) => sql);
  mockExplainSql.mockResolvedValue('Returns all users');
});

// ── READ_ONLY SELECT ──────────────────────────────────────────────────────────

describe('POST /api/query — READ_ONLY SELECT', () => {
  it('executes a SELECT and returns type: READ', async () => {
    mockGenerateSql.mockResolvedValue('SELECT * FROM users LIMIT 100');
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string; row_count: number };
    expect(body.type).toBe('READ');
    expect(body.row_count).toBe(1);
    await app.close();
  });

  it('defaults to READ_ONLY mode when mode is omitted', async () => {
    mockGenerateSql.mockResolvedValue('SELECT * FROM users LIMIT 100');
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGenerateSql).toHaveBeenCalledWith('show all users', fakeSchema, 'READ_ONLY');
    await app.close();
  });

  it('includes query, explanation, data, row_count in response', async () => {
    mockGenerateSql.mockResolvedValue('SELECT * FROM users LIMIT 100');
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Alice' }], rowCount: 1 });
    mockExplainSql.mockResolvedValue('Selects all users');
    mockFormatSql.mockReturnValue('SELECT *\nFROM users\nLIMIT 100');

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users', mode: 'READ_ONLY' },
    });

    const body = JSON.parse(response.body) as {
      query: string;
      explanation: string;
      data: unknown[];
      row_count: number;
      type: string;
    };
    expect(body.query).toBe('SELECT *\nFROM users\nLIMIT 100');
    expect(body.explanation).toBe('Selects all users');
    expect(body.data).toHaveLength(1);
    expect(body.row_count).toBe(1);
    expect(body.type).toBe('READ');
    await app.close();
  });
});

// ── CRUD INSERT ───────────────────────────────────────────────────────────────

describe('POST /api/query — CRUD_ENABLED INSERT', () => {
  it('executes INSERT directly and returns type: WRITE with affected_rows', async () => {
    const insertSql = "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')";
    mockGenerateSql.mockResolvedValue(insertSql);
    mockValidateSql.mockReturnValue({ sql: insertSql, statementType: 'INSERT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Alice', mode: 'CRUD_ENABLED' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string; affected_rows: number };
    expect(body.type).toBe('WRITE');
    expect(body.affected_rows).toBe(1);
    await app.close();
  });

  it('does not require confirm_write for INSERT', async () => {
    const insertSql = "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')";
    mockGenerateSql.mockResolvedValue(insertSql);
    mockValidateSql.mockReturnValue({ sql: insertSql, statementType: 'INSERT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Bob', mode: 'CRUD_ENABLED', confirm_write: false },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string };
    expect(body.type).toBe('WRITE');
    await app.close();
  });
});

// ── CRUD DELETE confirmation flow ─────────────────────────────────────────────

describe('POST /api/query — CRUD_ENABLED DELETE confirmation', () => {
  it('returns AWAITING_CONFIRMATION when confirm_write is missing', async () => {
    const deleteSql = "DELETE FROM users WHERE name = 'Rahul'";
    mockGenerateSql.mockResolvedValue(deleteSql);
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue("SELECT * FROM users WHERE name = 'Rahul' LIMIT 10");
    mockExecuteQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Rahul', email: 'rahul1@example.com' },
        { id: 2, name: 'Rahul', email: 'rahul2@example.com' },
      ],
      rowCount: 2,
    });
    mockExplainSql.mockResolvedValue("Deletes all users named Rahul");

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete all users named Rahul', mode: 'CRUD_ENABLED' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      type: string;
      operation: string;
      impact: { affected_rows: number; preview: unknown[]; warning: string };
      confirm_to_proceed: string;
    };
    expect(body.status).toBe('AWAITING_CONFIRMATION');
    expect(body.type).toBe('WRITE');
    expect(body.operation).toBe('DELETE');
    expect(body.impact.affected_rows).toBe(2);
    expect(body.impact.preview).toHaveLength(2);
    expect(body.impact.warning).toContain('cannot be undone');
    expect(body.confirm_to_proceed).toContain('confirm_write: true');
    await app.close();
  });

  it('returns AWAITING_CONFIRMATION when confirm_write is false', async () => {
    const deleteSql = 'DELETE FROM users WHERE id = 1';
    mockGenerateSql.mockResolvedValue(deleteSql);
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE id = 1 LIMIT 10');
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Alice' }], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete user 1', mode: 'CRUD_ENABLED', confirm_write: false },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('AWAITING_CONFIRMATION');
    await app.close();
  });

  it('executes DELETE when confirm_write is true and returns type: WRITE', async () => {
    const deleteSql = 'DELETE FROM users WHERE id = 1';
    mockGenerateSql.mockResolvedValue(deleteSql);
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete user 1', mode: 'CRUD_ENABLED', confirm_write: true },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string; affected_rows: number };
    expect(body.type).toBe('WRITE');
    expect(body.affected_rows).toBe(1);
    await app.close();
  });

  it('caps preview at 10 rows even when more are returned', async () => {
    const deleteSql = 'DELETE FROM users WHERE active = false';
    mockGenerateSql.mockResolvedValue(deleteSql);
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE active = false LIMIT 10');
    const manyRows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `User${i + 1}` }));
    mockExecuteQuery.mockResolvedValue({ rows: manyRows, rowCount: 50 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete inactive users', mode: 'CRUD_ENABLED' },
    });

    const body = JSON.parse(response.body) as {
      impact: { affected_rows: number; preview: unknown[] };
    };
    expect(body.impact.preview.length).toBeLessThanOrEqual(10);
    expect(body.impact.affected_rows).toBe(50);
    await app.close();
  });
});

// ── CRUD UPDATE confirmation flow ─────────────────────────────────────────────

describe('POST /api/query — CRUD_ENABLED UPDATE confirmation', () => {
  it('returns AWAITING_CONFIRMATION for UPDATE without confirm_write', async () => {
    const updateSql = "UPDATE users SET email = 'new@test.com' WHERE id = 1";
    mockGenerateSql.mockResolvedValue(updateSql);
    mockValidateSql.mockReturnValue({ sql: updateSql, statementType: 'UPDATE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE id = 1 LIMIT 10');
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Alice' }], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: "change user 1 email to new@test.com", mode: 'CRUD_ENABLED' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      operation: string;
      impact: { warning: string };
    };
    expect(body.status).toBe('AWAITING_CONFIRMATION');
    expect(body.operation).toBe('UPDATE');
    expect(body.impact.warning).toContain('modify');
    await app.close();
  });

  it('executes UPDATE when confirm_write is true', async () => {
    const updateSql = "UPDATE users SET email = 'new@test.com' WHERE id = 1";
    mockGenerateSql.mockResolvedValue(updateSql);
    mockValidateSql.mockReturnValue({ sql: updateSql, statementType: 'UPDATE' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: "change user 1 email", mode: 'CRUD_ENABLED', confirm_write: true },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string; affected_rows: number };
    expect(body.type).toBe('WRITE');
    expect(body.affected_rows).toBe(1);
    await app.close();
  });
});

// ── Cache behaviour ───────────────────────────────────────────────────────────

describe('POST /api/query — cache behaviour', () => {
  it('does not cache WRITE operations', async () => {
    const insertSql = "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')";
    mockGenerateSql.mockResolvedValue(insertSql);
    mockValidateSql.mockReturnValue({ sql: insertSql, statementType: 'INSERT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Alice', mode: 'CRUD_ENABLED' },
    });

    expect(mockSetCachedResult).not.toHaveBeenCalled();
    await app.close();
  });
});

// ── Validation error propagation ──────────────────────────────────────────────

describe('POST /api/query — error handling', () => {
  it('returns 400 when query field is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
