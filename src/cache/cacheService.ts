import { createHash } from 'crypto';
import type { Redis } from 'ioredis';
import type { QueryResponse } from '../types/api';
import { config } from '../config';

/**
 * Cache key format: cache:<provider>:<schemaVersion>:<sha256(normalizedQuestion)>
 *
 * The provider segment ensures the same NL query cached via different providers
 * is stored and served separately.
 */
const KEY_PREFIX = 'cache';

/**
 * Normalize a natural language question for stable cache keys:
 * lowercase, collapse whitespace, trim.
 */
function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute a namespaced cache key that includes the provider, schema version,
 * and a hash of the normalized question.
 */
export function buildCacheKey(question: string, schemaVersion: string, provider: string): string {
  const normalized = normalizeQuestion(question);
  const nlHash = createHash('sha256').update(normalized).digest('hex');
  return `${KEY_PREFIX}:${provider}:${schemaVersion}:${nlHash}`;
}

/**
 * Retrieve a cached query result. Returns null on miss or any Redis error.
 */
export async function getCachedResult(
  redis: Redis,
  question: string,
  schemaVersion: string,
  provider: string,
): Promise<QueryResponse | null> {
  try {
    const key = buildCacheKey(question, schemaVersion, provider);
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as QueryResponse;
  } catch {
    return null;
  }
}

/**
 * Store a query result in Redis with the configured TTL.
 * Failures are silently swallowed — cache is best-effort.
 */
export async function setCachedResult(
  redis: Redis,
  question: string,
  schemaVersion: string,
  provider: string,
  result: QueryResponse,
): Promise<void> {
  try {
    const key = buildCacheKey(question, schemaVersion, provider);
    await redis.set(key, JSON.stringify(result), 'EX', config.query.cacheTtlSeconds);
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate all cached query results (e.g., after a schema refresh).
 * Uses SCAN to avoid blocking Redis with KEYS *.
 */
export async function invalidateAllQueryCache(redis: Redis): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch {
    // Non-fatal
  }
}
