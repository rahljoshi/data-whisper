/**
 * Cache service tests use ioredis-mock (mapped via jest moduleNameMapper).
 * No real Redis connection is needed.
 */
import Redis from 'ioredis';
import {
  buildCacheKey,
  getCachedResult,
  setCachedResult,
  invalidateAllQueryCache,
} from './cacheService';
import type { QueryResponse } from '../types/api';

const sampleResult: QueryResponse = {
  query: 'SELECT * FROM users LIMIT 100',
  explanation: 'Retrieves all users.',
  data: [{ id: 1, name: 'Alice' }],
  row_count: 1,
  type: 'READ',
};

function makeRedis() {
  return new Redis();
}

// ── buildCacheKey ─────────────────────────────────────────────────────────────

describe('buildCacheKey', () => {
  it('returns a deterministic key for the same inputs', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc', 'anthropic');
    const key2 = buildCacheKey('show me all users', 'v1abc', 'anthropic');
    expect(key1).toBe(key2);
  });

  it('returns different keys for different questions', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc', 'anthropic');
    const key2 = buildCacheKey('show me all orders', 'v1abc', 'anthropic');
    expect(key1).not.toBe(key2);
  });

  it('returns different keys for different schema versions', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc', 'anthropic');
    const key2 = buildCacheKey('show me all users', 'v2xyz', 'anthropic');
    expect(key1).not.toBe(key2);
  });

  it('normalizes case and whitespace before hashing', () => {
    const key1 = buildCacheKey('  Show Me All Users  ', 'v1', 'openai');
    const key2 = buildCacheKey('show me all users', 'v1', 'openai');
    expect(key1).toBe(key2);
  });

  it('returns different keys for different providers (same question, same schema)', () => {
    const key1 = buildCacheKey('show me all users', 'v1', 'openai');
    const key2 = buildCacheKey('show me all users', 'v1', 'anthropic');
    const key3 = buildCacheKey('show me all users', 'v1', 'gemini');
    expect(key1).not.toBe(key2);
    expect(key2).not.toBe(key3);
    expect(key1).not.toBe(key3);
  });

  it('key starts with cache:<provider>: prefix', () => {
    const key = buildCacheKey('anything', 'v1', 'anthropic');
    expect(key).toMatch(/^cache:anthropic:/);
  });
});

// ── getCachedResult ───────────────────────────────────────────────────────────

describe('getCachedResult', () => {
  it('returns null on a cache miss', async () => {
    const redis = makeRedis();
    const result = await getCachedResult(redis, 'unknown question', 'v1', 'anthropic');
    expect(result).toBeNull();
  });

  it('returns the stored result on a cache hit (same provider)', async () => {
    const redis = makeRedis();
    const question = 'how many users are there';
    const version = 'v1abc';

    await setCachedResult(redis, question, version, 'anthropic', sampleResult);
    const cached = await getCachedResult(redis, question, version, 'anthropic');

    expect(cached).toEqual(sampleResult);
  });

  it('returns null when querying with a different provider (cache miss)', async () => {
    const redis = makeRedis();
    const question = 'list only the admin users for provider isolation test';
    const version = 'v1abc';

    await setCachedResult(redis, question, version, 'openai', sampleResult);
    const cached = await getCachedResult(redis, question, version, 'anthropic');

    expect(cached).toBeNull();
  });

  it('returns null when Redis throws an error', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('Redis connection refused'));

    const result = await getCachedResult(redis, 'question', 'v1', 'anthropic');
    expect(result).toBeNull();
  });
});

// ── setCachedResult ───────────────────────────────────────────────────────────

describe('setCachedResult', () => {
  it('stores a result that can be retrieved', async () => {
    const redis = makeRedis();
    await setCachedResult(redis, 'top 5 orders', 'v2', 'gemini', sampleResult);
    const cached = await getCachedResult(redis, 'top 5 orders', 'v2', 'gemini');
    expect(cached).toEqual(sampleResult);
  });

  it('does not throw when Redis set fails', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      setCachedResult(redis, 'question', 'v1', 'anthropic', sampleResult),
    ).resolves.not.toThrow();
  });
});

// ── invalidateAllQueryCache ───────────────────────────────────────────────────

describe('invalidateAllQueryCache', () => {
  it('removes all cache: keys across all providers', async () => {
    const redis = makeRedis();

    await setCachedResult(redis, 'question one', 'v1', 'openai', sampleResult);
    await setCachedResult(redis, 'question two', 'v1', 'anthropic', sampleResult);
    await setCachedResult(redis, 'question three', 'v1', 'gemini', sampleResult);

    await invalidateAllQueryCache(redis);

    const after1 = await getCachedResult(redis, 'question one', 'v1', 'openai');
    const after2 = await getCachedResult(redis, 'question two', 'v1', 'anthropic');
    const after3 = await getCachedResult(redis, 'question three', 'v1', 'gemini');

    expect(after1).toBeNull();
    expect(after2).toBeNull();
    expect(after3).toBeNull();
  });

  it('does not throw when Redis scan fails', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'scan').mockRejectedValueOnce(new Error('scan error'));

    await expect(invalidateAllQueryCache(redis)).resolves.not.toThrow();
  });
});
