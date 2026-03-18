import type { Pool } from 'pg';
import { AppError, ErrorType } from '../types/errors';
import type { QueryMode } from '../types/api';

export type UserRole = 'admin' | 'analyst' | 'readonly';

export interface RbacRole {
  user_id: string;
  role: UserRole;
  allowed_tables: string[];
  allow_crud: boolean;
}

export interface UserContext {
  userId: string;
  role: UserRole;
}

const VALID_ROLES: Set<string> = new Set(['admin', 'analyst', 'readonly']);

/**
 * Extract user context from request headers.
 * Throws USER_CONTEXT_MISSING if headers are absent or invalid.
 */
export function extractUserContext(headers: Record<string, string | string[] | undefined>): UserContext {
  const userId = headers['x-user-id'];
  const userRole = headers['x-user-role'];

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new AppError(ErrorType.USER_CONTEXT_MISSING, 'X-User-Id header is required.');
  }

  if (!userRole || typeof userRole !== 'string' || !VALID_ROLES.has(userRole)) {
    throw new AppError(
      ErrorType.USER_CONTEXT_MISSING,
      `X-User-Role header is required and must be one of: ${[...VALID_ROLES].join(', ')}.`,
    );
  }

  return { userId: userId.trim(), role: userRole as UserRole };
}

/**
 * Load RBAC role for a user from the database.
 * Returns null if the user has no explicit role configured.
 */
export async function loadUserRole(pool: Pool, userId: string): Promise<RbacRole | null> {
  const result = await pool.query<RbacRole>(
    `SELECT user_id, role, allowed_tables, allow_crud
     FROM rbac_roles
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Validate that the user is allowed to access the given tables and use the requested mode.
 *
 * Rules:
 * - admin: bypasses table restrictions but not validation
 * - non-admin cannot use CRUD mode (CRUD_NOT_ALLOWED)
 * - non-admin must have all accessed tables in allowed_tables (TABLE_ACCESS_DENIED)
 */
export function validateAccess(
  userContext: UserContext,
  rbacRole: RbacRole | null,
  accessedTables: string[],
  mode: QueryMode,
): void {
  const { role } = userContext;

  // Admins bypass table restrictions
  if (role === 'admin') return;

  // Non-admin cannot use CRUD mode
  if (mode === 'CRUD_ENABLED') {
    throw new AppError(
      ErrorType.CRUD_NOT_ALLOWED,
      `Role '${role}' is not permitted to use CRUD mode.`,
    );
  }

  if (!rbacRole) {
    // User has no DB-level role config — deny all table access for non-admins
    if (accessedTables.length > 0) {
      throw new AppError(
        ErrorType.TABLE_ACCESS_DENIED,
        `No role configuration found for user. Table access denied.`,
      );
    }
    return;
  }

  const deniedTables = accessedTables.filter(
    (table) => !rbacRole.allowed_tables.includes(table),
  );

  if (deniedTables.length > 0) {
    throw new AppError(
      ErrorType.TABLE_ACCESS_DENIED,
      `Access denied to table(s): ${deniedTables.join(', ')}.`,
    );
  }
}

/**
 * Extract table names referenced in a SQL AST parse result.
 * Uses node-sql-parser's parsed output to list unique table names.
 */
export function extractTablesFromSql(sql: string): string[] {
  try {
    // Simple regex-based table extraction as a fallback.
    // The AST-level extraction happens in sqlValidator.ts — we re-extract here for RBAC checks.
    const { Parser } = require('node-sql-parser') as { Parser: new () => { astify: (sql: string) => unknown } };
    const parser = new Parser();
    const ast = parser.astify(sql) as unknown;

    const tables = new Set<string>();
    extractTablesFromAst(ast, tables);
    return [...tables];
  } catch {
    return [];
  }
}

function extractTablesFromAst(node: unknown, tables: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj)) {
    for (const item of obj) extractTablesFromAst(item, tables);
    return;
  }

  if (obj['table'] && typeof obj['table'] === 'string') {
    tables.add(obj['table'] as string);
  }

  for (const key of Object.keys(obj)) {
    if (key !== 'table') {
      extractTablesFromAst(obj[key], tables);
    }
  }
}
