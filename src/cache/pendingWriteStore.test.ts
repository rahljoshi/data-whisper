/**
 * pendingWriteStore tests use ioredis-mock (mapped via jest moduleNameMapper).
 * No real Redis connection is needed.
 */
import Redis from 'ioredis';
import {
  storePendingWrite,
  getPendingWrite,
  type PendingWrite,
} from './pendingWriteStore';

function makeRedis() {
  return new Redis();
}

const samplePending: PendingWrite = {
  sql: 'DELETE FROM users WHERE id = 1',
  formattedSql: 'DELETE FROM users\nWHERE id = 1',
  explanation: 'Deletes user with id 1',
  operation: 'DELETE',
};

describe('storePendingWrite + getPendingWrite — happy path', () => {
  it('stores a pending write and retrieves it by token', async () => {
    const redis = makeRedis();
    const token = await storePendingWrite(redis, samplePending, 60);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const retrieved = await getPendingWrite(redis, token);
    expect(retrieved).toEqual(samplePending);
  });

  it('returns null for an unknown token', async () => {
    const redis = makeRedis();
    const result = await getPendingWrite(redis, 'nonexistent-token-xyz');
    expect(result).toBeNull();
  });

  it('generates a unique token for each call', async () => {
    const redis = makeRedis();
    const token1 = await storePendingWrite(redis, samplePending, 60);
    const token2 = await storePendingWrite(redis, samplePending, 60);
    expect(token1).not.toBe(token2);
  });
});

describe('storePendingWrite + getPendingWrite — in-memory fallback (no Redis)', () => {
  it('stores and retrieves without Redis', async () => {
    const token = await storePendingWrite(null, samplePending, 60);
    expect(typeof token).toBe('string');

    const retrieved = await getPendingWrite(null, token);
    expect(retrieved).toEqual(samplePending);
  });

  it('returns null for unknown token without Redis', async () => {
    const result = await getPendingWrite(null, 'no-such-token');
    expect(result).toBeNull();
  });
});

describe('getPendingWrite — Redis errors are swallowed', () => {
  it('returns null when Redis throws', async () => {
    const redis = makeRedis();
    jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('Redis error'));
    const result = await getPendingWrite(redis, 'any-token');
    expect(result).toBeNull();
  });
});
