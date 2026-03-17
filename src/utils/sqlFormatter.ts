import { format } from 'sql-formatter';

/**
 * Identifiers that node-sql-parser wraps in double quotes unnecessarily.
 * We strip quotes around simple lowercase names (letters, digits, underscores)
 * so the output reads like hand-written SQL rather than AST-serialized SQL.
 */
function stripUnnecessaryQuotes(sql: string): string {
  // Remove double-quotes around plain lowercase identifiers: "foo_bar" → foo_bar
  return sql.replace(/"([a-z_][a-z0-9_]*)"/g, '$1');
}

/**
 * Format a SQL string into readable, indented PostgreSQL.
 *
 * Applies:
 *  1. Removes unnecessary double-quotes from lowercase identifiers
 *  2. Uppercases keywords (SELECT, FROM, WHERE, …)
 *  3. Indents clauses with 2-space tabs
 *  4. Puts each selected column on its own line
 *
 * Never throws — falls back to the unformatted string on any error.
 */
export function formatSql(sql: string): string {
  try {
    const unquoted = stripUnnecessaryQuotes(sql);
    return format(unquoted, {
      language: 'postgresql',
      tabWidth: 2,
      keywordCase: 'upper',
      dataTypeCase: 'upper',
      functionCase: 'upper',
      indentStyle: 'standard',
      linesBetweenQueries: 1,
    });
  } catch {
    return sql;
  }
}
