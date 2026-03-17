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
};

function makeRedis() {
  // ioredis-mock is injected via jest moduleNameMapper
  return new Redis();
}

// ── buildCacheKey ─────────────────────────────────────────────────────────────

describe('buildCacheKey', () => {
  it('returns a deterministic key for the same inputs', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc');
    const key2 = buildCacheKey('show me all users', 'v1abc');
    expect(key1).toBe(key2);
  });

  it('returns different keys for different questions', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc');
    const key2 = buildCacheKey('show me all orders', 'v1abc');
    expect(key1).not.toBe(key2);
  });

  it('returns different keys for different schema versions', () => {
    const key1 = buildCacheKey('show me all users', 'v1abc');
    const key2 = buildCacheKey('show me all users', 'v2xyz');
    expect(key1).not.toBe(key2);
  });

  it('normalizes case and whitespace before hashing', () => {
    const key1 = buildCacheKey('  Show Me All Users  ', 'v1');
    const key2 = buildCacheKey('show me all users', 'v1');
    expect(key1).toBe(key2);
  });

  it('key has the data-whisper:query: prefix', () => {
    const key = buildCacheKey('anything', 'v1');
    expect(key).toMatch(/^data-whisper:query:/);
  });
});

// ── getCachedResult ───────────────────────────────────────────────────────────

describe('getCachedResult', () => {
  it('returns null on a cache miss', async () => {
    const redis = makeRedis();
    const result = await getCachedResult(redis, 'unknown question', 'v1');
    expect(result).toBeNull();
  });

  it('returns the stored result on a cache hit', async () => {
    const redis = makeRedis();
    const question = 'how many users are there';
    const version = 'v1abc';

    await setCachedResult(redis, question, version, sampleResult);
    const cached = await getCachedResult(redis, question, version);

    expect(cached).toEqual(sampleResult);
  });

  it('returns null when Redis throws an error', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('Redis connection refused'));

    const result = await getCachedResult(redis, 'question', 'v1');
    expect(result).toBeNull();
  });
});

// ── setCachedResult ───────────────────────────────────────────────────────────

describe('setCachedResult', () => {
  it('stores a result that can be retrieved', async () => {
    const redis = makeRedis();
    await setCachedResult(redis, 'top 5 orders', 'v2', sampleResult);
    const cached = await getCachedResult(redis, 'top 5 orders', 'v2');
    expect(cached).toEqual(sampleResult);
  });

  it('does not throw when Redis set fails', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      setCachedResult(redis, 'question', 'v1', sampleResult),
    ).resolves.not.toThrow();
  });
});

// ── invalidateAllQueryCache ───────────────────────────────────────────────────

describe('invalidateAllQueryCache', () => {
  it('removes all data-whisper:query: keys', async () => {
    const redis = makeRedis();

    await setCachedResult(redis, 'question one', 'v1', sampleResult);
    await setCachedResult(redis, 'question two', 'v1', sampleResult);

    await invalidateAllQueryCache(redis);

    const after1 = await getCachedResult(redis, 'question one', 'v1');
    const after2 = await getCachedResult(redis, 'question two', 'v1');

    expect(after1).toBeNull();
    expect(after2).toBeNull();
  });

  it('does not throw when Redis scan fails', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'scan').mockRejectedValueOnce(new Error('scan error'));

    await expect(invalidateAllQueryCache(redis)).resolves.not.toThrow();
  });
});
