/**
 * Every LLM provider must implement this interface.
 * ai.service.ts only ever talks to this contract — never to any provider SDK directly.
 */
export interface LLMProvider {
  /** Unique provider identifier, e.g. 'openai' | 'anthropic' | 'gemini' */
  readonly name: string;
  /** Exact model name used for requests, e.g. 'gpt-4o' */
  readonly model: string;

  /**
   * Generate a SQL statement from a natural language query.
   *
   * @param schema  - Schema DDL already rendered as a plain string
   * @param nlQuery - Sanitized natural language question
   * @param mode    - 'READ_ONLY' | 'CRUD_ENABLED'
   * @returns Raw SQL string (code fences stripped, whitespace trimmed).
   *          May return the sentinel value 'CANNOT_ANSWER' — callers must handle it.
   */
  generateSQL(schema: string, nlQuery: string, mode: string): Promise<string>;

  /**
   * Produce a one-sentence plain-English explanation of a SQL statement.
   *
   * @param sql - The SQL to explain
   * @returns A single descriptive sentence.
   */
  explainSQL(sql: string): Promise<string>;
}
