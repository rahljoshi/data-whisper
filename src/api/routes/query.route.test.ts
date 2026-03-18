/**
 * Route tests for POST /api/query and POST /api/query/confirm.
 * All external modules are mocked at the boundary.
 * mode is read from config (service-level), not the request body.
 */

jest.mock('../../ai/ai.service');
jest.mock('../../validation/sqlValidator');
jest.mock('../../execution/queryExecutor');
jest.mock('../../cache/cacheService');
jest.mock('../../schema/schemaService');
jest.mock('../../utils/sqlFormatter');
jest.mock('../../cache/pendingWriteStore');
jest.mock('../../history/historyService');
jest.mock('../../rbac/rbacService');
jest.mock('../../execution/costEstimator');
jest.mock('../../config', () => ({
  config: {
    query: {
      mode: 'READ_ONLY',
      timeoutMs: 5000,
      maxRows: 100,
      cacheTtlSeconds: 3600,
      schemaRefreshIntervalMs: 600000,
      pendingWriteTtlSeconds: 300,
    },
    llm: { provider: 'anthropic' },
    security: { maxQuestionLength: 2000, sensitiveColumnPatterns: [] },
    rateLimit: { max: 60, windowMs: 60000 },
  },
}));

import Fastify from 'fastify';
import { queryRoutes } from './query.route';
import { generateSQL, explainSQL } from '../../ai/ai.service';
import { validateSql, buildPreviewSql } from '../../validation/sqlValidator';
import { executeQuery } from '../../execution/queryExecutor';
import { getCachedResult, setCachedResult } from '../../cache/cacheService';
import { getSchema, getSchemaVersion } from '../../schema/schemaService';
import { formatSql } from '../../utils/sqlFormatter';
import { storePendingWrite, getPendingWrite } from '../../cache/pendingWriteStore';
import { insertHistory } from '../../history/historyService';
import { estimateQueryCost, assertCostAcceptable } from '../../execution/costEstimator';
import { config } from '../../config';
import type { DbSchema } from '../../types/schema';
import type { PendingWrite } from '../../cache/pendingWriteStore';
import type { Pool } from 'pg';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockConfig = config as { query: { mode: string } };
const mockGenerateSQL = generateSQL as jest.MockedFunction<typeof generateSQL>;
const mockExplainSQL = explainSQL as jest.MockedFunction<typeof explainSQL>;
const mockValidateSql = validateSql as jest.MockedFunction<typeof validateSql>;
const mockBuildPreviewSql = buildPreviewSql as jest.MockedFunction<typeof buildPreviewSql>;
const mockExecuteQuery = executeQuery as jest.MockedFunction<typeof executeQuery>;
const mockGetCachedResult = getCachedResult as jest.MockedFunction<typeof getCachedResult>;
const mockSetCachedResult = setCachedResult as jest.MockedFunction<typeof setCachedResult>;
const mockGetSchema = getSchema as jest.MockedFunction<typeof getSchema>;
const mockGetSchemaVersion = getSchemaVersion as jest.MockedFunction<typeof getSchemaVersion>;
const mockFormatSql = formatSql as jest.MockedFunction<typeof formatSql>;
const mockStorePendingWrite = storePendingWrite as jest.MockedFunction<typeof storePendingWrite>;
const mockGetPendingWrite = getPendingWrite as jest.MockedFunction<typeof getPendingWrite>;
const mockInsertHistory = insertHistory as jest.MockedFunction<typeof insertHistory>;
const mockEstimateQueryCost = estimateQueryCost as jest.MockedFunction<typeof estimateQueryCost>;
const mockAssertCostAcceptable = assertCostAcceptable as jest.MockedFunction<typeof assertCostAcceptable>;

const mockPool = {} as Pool;

// ── Test setup ────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(queryRoutes, { redis: null, pool: mockPool });
  await app.ready();
  return app;
}

const fakeSchema = new Map() as DbSchema;

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.query.mode = 'READ_ONLY';
  mockGetSchema.mockReturnValue(fakeSchema);
  mockGetSchemaVersion.mockReturnValue('v1');
  mockGetCachedResult.mockResolvedValue(null);
  mockSetCachedResult.mockResolvedValue(undefined);
  mockFormatSql.mockImplementation((sql) => sql);
  mockExplainSQL.mockResolvedValue({ explanation: 'Returns all users', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
  mockStorePendingWrite.mockResolvedValue('test-token-123');
  mockInsertHistory.mockResolvedValue('new-history-id');
  mockEstimateQueryCost.mockResolvedValue({
    total_cost: 10,
    has_seq_scan: false,
    seq_scan_tables: [],
    estimated_rows: 100,
    plan_summary: 'Index Scan',
  });
  mockAssertCostAcceptable.mockReturnValue(undefined);
});

// ── Request body: only query field ───────────────────────────────────────────

describe('POST /api/query — request body shape', () => {
  it('accepts a request with only { query }', async () => {
    mockGenerateSQL.mockResolvedValue({ sql: 'SELECT * FROM users LIMIT 100', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users' },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('ignores mode or confirm_write if accidentally included in the body', async () => {
    // Fastify strips unknown fields (additionalProperties: false = removeAdditional).
    // The route must use config.query.mode, not any body field.
    mockGenerateSQL.mockResolvedValue({ sql: 'SELECT * FROM users LIMIT 100', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users', mode: 'CRUD_ENABLED' },
    });

    // Mode must come from config (READ_ONLY), not the body field
    expect(mockGenerateSQL).toHaveBeenCalledWith('show all users', fakeSchema, 'READ_ONLY', undefined);
    await app.close();
  });

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

// ── READ_ONLY SELECT (mode from config) ──────────────────────────────────────

describe('POST /api/query — READ_ONLY SELECT (config-driven)', () => {
  it('reads mode from config, not the request body', async () => {
    mockGenerateSQL.mockResolvedValue({ sql: 'SELECT * FROM users LIMIT 100', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users' },
    });

    expect(mockGenerateSQL).toHaveBeenCalledWith('show all users', fakeSchema, 'READ_ONLY', undefined);
    await app.close();
  });

  it('returns type: READ on SELECT', async () => {
    mockGenerateSQL.mockResolvedValue({ sql: 'SELECT * FROM users LIMIT 100', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: 'SELECT * FROM users LIMIT 100', statementType: 'SELECT' });
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'show all users' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string };
    expect(body.type).toBe('READ');
    await app.close();
  });
});

// ── CRUD_ENABLED INSERT (mode from config) ────────────────────────────────────

describe('POST /api/query — CRUD_ENABLED INSERT', () => {
  beforeEach(() => {
    mockConfig.query.mode = 'CRUD_ENABLED';
  });

  it('executes INSERT directly and returns type: WRITE', async () => {
    const insertSql = "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')";
    mockGenerateSQL.mockResolvedValue({ sql: insertSql, provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: insertSql, statementType: 'INSERT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Alice' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { type: string; affected_rows: number };
    expect(body.type).toBe('WRITE');
    expect(body.affected_rows).toBe(1);
    await app.close();
  });

  it('passes CRUD_ENABLED mode to generateSQL', async () => {
    mockGenerateSQL.mockResolvedValue({ sql: "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')", provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({
      sql: "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')",
      statementType: 'INSERT',
    });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Bob' },
    });

    expect(mockGenerateSQL).toHaveBeenCalledWith('add user Bob', fakeSchema, 'CRUD_ENABLED', undefined);
    await app.close();
  });
});

// ── CRUD_ENABLED DELETE — confirmation flow ───────────────────────────────────

describe('POST /api/query — CRUD_ENABLED DELETE returns AWAITING_CONFIRMATION', () => {
  beforeEach(() => {
    mockConfig.query.mode = 'CRUD_ENABLED';
  });

  it('returns AWAITING_CONFIRMATION with confirmation_token', async () => {
    const deleteSql = "DELETE FROM users WHERE name = 'Rahul'";
    mockGenerateSQL.mockResolvedValue({ sql: deleteSql, provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue("SELECT * FROM users WHERE name = 'Rahul' LIMIT 10");
    mockExecuteQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Rahul', email: 'rahul1@example.com' },
        { id: 2, name: 'Rahul', email: 'rahul2@example.com' },
      ],
      rowCount: 2,
    });
    mockStorePendingWrite.mockResolvedValue('abc-token-123');

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete all users named Rahul' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      type: string;
      operation: string;
      confirmation_token: string;
      impact: { affected_rows: number; preview: unknown[]; warning: string };
      confirm_to_proceed: string;
    };
    expect(body.status).toBe('AWAITING_CONFIRMATION');
    expect(body.type).toBe('WRITE');
    expect(body.operation).toBe('DELETE');
    expect(body.confirmation_token).toBe('abc-token-123');
    expect(body.impact.affected_rows).toBe(2);
    expect(body.impact.preview).toHaveLength(2);
    expect(body.impact.warning).toContain('cannot be undone');
    expect(body.confirm_to_proceed).toContain('/api/query/confirm');
    await app.close();
  });

  it('stores the pending write in the store', async () => {
    const deleteSql = 'DELETE FROM users WHERE id = 1';
    mockGenerateSQL.mockResolvedValue({ sql: deleteSql, provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: deleteSql, statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE id = 1 LIMIT 10');
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete user 1' },
    });

    expect(mockStorePendingWrite).toHaveBeenCalledTimes(1);
    const [, pendingArg] = mockStorePendingWrite.mock.calls[0] as [unknown, PendingWrite, number];
    expect(pendingArg.sql).toBe(deleteSql);
    expect(pendingArg.operation).toBe('DELETE');
    await app.close();
  });

  it('does not execute the write SQL, only the preview SELECT', async () => {
    mockGenerateSQL.mockResolvedValue({ sql: 'DELETE FROM users WHERE id = 1', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: 'DELETE FROM users WHERE id = 1', statementType: 'DELETE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE id = 1 LIMIT 10');
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'delete user 1' },
    });

    // executeQuery called once — only the preview SELECT, not the DELETE
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = 1 LIMIT 10');
    await app.close();
  });
});

// ── CRUD_ENABLED UPDATE — confirmation flow ───────────────────────────────────

describe('POST /api/query — CRUD_ENABLED UPDATE returns AWAITING_CONFIRMATION', () => {
  beforeEach(() => {
    mockConfig.query.mode = 'CRUD_ENABLED';
  });

  it('returns AWAITING_CONFIRMATION with UPDATE warning', async () => {
    const updateSql = "UPDATE users SET email = 'new@test.com' WHERE id = 1";
    mockGenerateSQL.mockResolvedValue({ sql: updateSql, provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: updateSql, statementType: 'UPDATE' });
    mockBuildPreviewSql.mockReturnValue('SELECT * FROM users WHERE id = 1 LIMIT 10');
    mockExecuteQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Alice' }], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'change email of user 1' },
    });

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
});

// ── POST /api/query/confirm ───────────────────────────────────────────────────

describe('POST /api/query/confirm', () => {
  it('executes the pending write and returns type: WRITE', async () => {
    const pending: PendingWrite = {
      sql: 'DELETE FROM users WHERE id = 1',
      formattedSql: 'DELETE FROM users\nWHERE id = 1',
      explanation: 'Deletes user with id 1',
      operation: 'DELETE',
    };
    mockGetPendingWrite.mockResolvedValue(pending);
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/confirm',
      payload: { token: 'abc-123' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      type: string;
      affected_rows: number;
      query: string;
      explanation: string;
    };
    expect(body.type).toBe('WRITE');
    expect(body.affected_rows).toBe(1);
    expect(body.query).toBe('DELETE FROM users\nWHERE id = 1');
    expect(body.explanation).toBe('Deletes user with id 1');
    await app.close();
  });

  it('returns 404 when token is not found or expired', async () => {
    mockGetPendingWrite.mockResolvedValue(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/confirm',
      payload: { token: 'expired-or-unknown' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: { type: string } };
    expect(body.error.type).toBe('TOKEN_NOT_FOUND');
    await app.close();
  });

  it('returns 400 when token field is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/confirm',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('executes the SQL stored in the pending write', async () => {
    const pending: PendingWrite = {
      sql: "UPDATE users SET email = 'new@test.com' WHERE id = 5",
      formattedSql: "UPDATE users\nSET email = 'new@test.com'\nWHERE id = 5",
      explanation: 'Updates email of user 5',
      operation: 'UPDATE',
    };
    mockGetPendingWrite.mockResolvedValue(pending);
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query/confirm',
      payload: { token: 'some-token' },
    });

    expect(mockExecuteQuery).toHaveBeenCalledWith(pending.sql);
    await app.close();
  });
});

// ── Cache behaviour ───────────────────────────────────────────────────────────

describe('POST /api/query — cache behaviour', () => {
  it('does not cache WRITE operations', async () => {
    mockConfig.query.mode = 'CRUD_ENABLED';
    const insertSql = "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')";
    mockGenerateSQL.mockResolvedValue({ sql: insertSql, provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    mockValidateSql.mockReturnValue({ sql: insertSql, statementType: 'INSERT' });
    mockExecuteQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { query: 'add user Alice' },
    });

    expect(mockSetCachedResult).not.toHaveBeenCalled();
    await app.close();
  });
});
