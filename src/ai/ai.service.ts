import { config } from '../config';
import { AppError, ErrorType } from '../types/errors';
import type { DbSchema } from '../types/schema';
import type { QueryMode } from '../types/api';
import { schemaToPromptString } from '../schema/schemaService';
import type { LLMProvider } from './provider.interface';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';

// ── Injection patterns — validated before reaching any provider ───────────────

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+instructions/i,
  /system\s*:/i,
  /\[SYSTEM\]/i,
  /you\s+are\s+now/i,
  /new\s+instructions/i,
  /forget\s+everything/i,
];

const CANNOT_ANSWER_SENTINEL = 'CANNOT_ANSWER';

function sanitizeQuestion(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let sanitized = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  sanitized = sanitized.trim();

  if (sanitized.length > config.security.maxQuestionLength) {
    throw new AppError(
      ErrorType.VALIDATION_ERROR,
      `Question exceeds maximum length of ${config.security.maxQuestionLength} characters`,
    );
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      throw new AppError(ErrorType.VALIDATION_ERROR, 'Question contains disallowed content');
    }
  }

  return sanitized;
}

// ── Provider registry — built at module load time ─────────────────────────────

function buildProviderRegistry(): Map<string, LLMProvider> {
  const map = new Map<string, LLMProvider>();

  if (config.llm.openaiApiKey) {
    map.set('openai', new OpenAIProvider(
      config.llm.openaiApiKey,
      config.llm.openaiModel,
      config.llm.maxTokens,
      config.llm.temperature,
    ));
  }

  if (config.llm.anthropicApiKey) {
    map.set('anthropic', new AnthropicProvider(
      config.llm.anthropicApiKey,
      config.llm.anthropicModel,
      config.llm.maxTokens,
    ));
  }

  if (config.llm.geminiApiKey) {
    map.set('gemini', new GeminiProvider(
      config.llm.geminiApiKey,
      config.llm.geminiModel,
      config.llm.maxTokens,
    ));
  }

  return map;
}

// ── Lazy registry — built on first use so mocks work correctly in tests ───────

let _registry: Map<string, LLMProvider> | null = null;

function getRegistry(): Map<string, LLMProvider> {
  if (!_registry) {
    _registry = buildProviderRegistry();
  }
  return _registry;
}

/**
 * Reset the provider registry (for testing only).
 * Call this in beforeEach after setting up mock implementations.
 */
export function _resetProviderRegistry(): void {
  _registry = null;
}

/**
 * Validate that the configured default provider has an API key.
 * Called once at startup — throws with a clear message, not at request time.
 */
export function validateProviderConfig(): void {
  const registry = getRegistry();
  if (!registry.has(config.llm.provider)) {
    throw new Error(
      `LLM provider "${config.llm.provider}" is configured as default but its API key is not set. ` +
      `Set the corresponding API key env var and restart.`,
    );
  }
}

function getProvider(name: string): LLMProvider {
  const registry = getRegistry();
  const provider = registry.get(name);
  if (!provider) {
    throw new AppError(
      ErrorType.AI_UNAVAILABLE,
      `LLM provider "${name}" is not available. ` +
      `Check that the API key env var is set and the provider name is one of: ${[...registry.keys()].join(', ')}.`,
    );
  }
  return provider;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateSQLResult {
  sql: string;
  provider: string;
  model: string;
}

export interface ExplainSQLResult {
  explanation: string;
  provider: string;
  model: string;
}

/**
 * Generate a SQL statement from a natural language question.
 * Handles sanitization, provider selection, and CANNOT_ANSWER detection.
 */
export async function generateSQL(
  question: string,
  schema: DbSchema,
  mode: QueryMode,
  providerName?: string,
): Promise<GenerateSQLResult> {
  const sanitized = sanitizeQuestion(question);
  const schemaDdl = schemaToPromptString(schema);
  const resolvedName = providerName ?? config.llm.provider;
  const provider = getProvider(resolvedName);

  const raw = await provider.generateSQL(schemaDdl, sanitized, mode);

  if (raw.toUpperCase().startsWith(CANNOT_ANSWER_SENTINEL)) {
    throw new AppError(
      ErrorType.AMBIGUOUS_QUERY,
      'The question cannot be answered with the available database schema',
    );
  }

  return { sql: raw, provider: provider.name, model: provider.model };
}

/**
 * Generate a plain-English explanation for a SQL statement.
 * Returns a generic fallback if the provider returns an empty string.
 */
export async function explainSQL(
  sql: string,
  providerName?: string,
): Promise<ExplainSQLResult> {
  const resolvedName = providerName ?? config.llm.provider;
  const provider = getProvider(resolvedName);

  const explanation = await provider.explainSQL(sql);

  return {
    explanation: explanation || 'Retrieves data from the database based on the specified criteria.',
    provider: provider.name,
    model: provider.model,
  };
}
