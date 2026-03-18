import { extractUserContext, validateAccess, loadUserRole } from './rbacService';
import { AppError, ErrorType } from '../types/errors';
import type { Pool } from 'pg';

describe('extractUserContext', () => {
  it('returns UserContext for valid headers', () => {
    const ctx = extractUserContext({
      'x-user-id': 'user-123',
      'x-user-role': 'analyst',
    });
    expect(ctx).toEqual({ userId: 'user-123', role: 'analyst' });
  });

  it('throws USER_CONTEXT_MISSING when X-User-Id is missing', () => {
    expect(() =>
      extractUserContext({ 'x-user-role': 'analyst' }),
    ).toThrow(AppError);

    expect(() =>
      extractUserContext({ 'x-user-role': 'analyst' }),
    ).toThrow(expect.objectContaining({ type: ErrorType.USER_CONTEXT_MISSING }));
  });

  it('throws USER_CONTEXT_MISSING when X-User-Role is missing', () => {
    expect(() =>
      extractUserContext({ 'x-user-id': 'user-123' }),
    ).toThrow(expect.objectContaining({ type: ErrorType.USER_CONTEXT_MISSING }));
  });

  it('throws USER_CONTEXT_MISSING when X-User-Role is invalid', () => {
    expect(() =>
      extractUserContext({ 'x-user-id': 'user-123', 'x-user-role': 'superuser' }),
    ).toThrow(expect.objectContaining({ type: ErrorType.USER_CONTEXT_MISSING }));
  });

  it('accepts all valid roles', () => {
    for (const role of ['admin', 'analyst', 'readonly']) {
      const ctx = extractUserContext({ 'x-user-id': 'u1', 'x-user-role': role });
      expect(ctx.role).toBe(role);
    }
  });
});

describe('validateAccess', () => {
  const adminCtx = { userId: 'admin-1', role: 'admin' as const };
  const analystCtx = { userId: 'analyst-1', role: 'analyst' as const };
  const readonlyCtx = { userId: 'readonly-1', role: 'readonly' as const };

  const rbacRole = {
    user_id: 'analyst-1',
    role: 'analyst' as const,
    allowed_tables: ['orders', 'products'],
    allow_crud: false,
  };

  it('allows admin to access any table', () => {
    expect(() =>
      validateAccess(adminCtx, null, ['secret_table', 'another_table'], 'READ_ONLY'),
    ).not.toThrow();
  });

  it('allows analyst to access allowed tables in READ_ONLY mode', () => {
    expect(() =>
      validateAccess(analystCtx, rbacRole, ['orders', 'products'], 'READ_ONLY'),
    ).not.toThrow();
  });

  it('throws TABLE_ACCESS_DENIED when analyst accesses disallowed table', () => {
    expect(() =>
      validateAccess(analystCtx, rbacRole, ['orders', 'users'], 'READ_ONLY'),
    ).toThrow(expect.objectContaining({ type: ErrorType.TABLE_ACCESS_DENIED }));
  });

  it('throws CRUD_NOT_ALLOWED when non-admin uses CRUD mode', () => {
    expect(() =>
      validateAccess(analystCtx, rbacRole, ['orders'], 'CRUD_ENABLED'),
    ).toThrow(expect.objectContaining({ type: ErrorType.CRUD_NOT_ALLOWED }));
  });

  it('throws CRUD_NOT_ALLOWED for readonly role', () => {
    const roRole = { ...rbacRole, user_id: 'readonly-1', role: 'readonly' as const };
    expect(() =>
      validateAccess(readonlyCtx, roRole, ['orders'], 'CRUD_ENABLED'),
    ).toThrow(expect.objectContaining({ type: ErrorType.CRUD_NOT_ALLOWED }));
  });

  it('throws TABLE_ACCESS_DENIED when no rbacRole configured for non-admin with tables', () => {
    expect(() =>
      validateAccess(analystCtx, null, ['orders'], 'READ_ONLY'),
    ).toThrow(expect.objectContaining({ type: ErrorType.TABLE_ACCESS_DENIED }));
  });

  it('allows non-admin with no rbacRole when no tables are accessed', () => {
    expect(() =>
      validateAccess(analystCtx, null, [], 'READ_ONLY'),
    ).not.toThrow();
  });
});

describe('loadUserRole', () => {
  it('returns role when found', async () => {
    const row = {
      user_id: 'user-1',
      role: 'analyst',
      allowed_tables: ['orders', 'products'],
      allow_crud: false,
    };
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [row] }),
    } as unknown as Pool;

    const result = await loadUserRole(pool, 'user-1');
    expect(result).toEqual(row);
  });

  it('returns null when not found', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    const result = await loadUserRole(pool, 'unknown');
    expect(result).toBeNull();
  });
});
