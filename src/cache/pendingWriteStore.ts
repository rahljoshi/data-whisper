import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';

const KEY_PREFIX = 'data-whisper:pending-write:';

export interface PendingWrite {
  sql: string;
  formattedSql: string;
  explanation: string;
  operation: 'UPDATE' | 'DELETE';
}

/**
 * In-memory fallback store for environments without Redis.
 * Entries are expired lazily on read.
 */
const memoryStore = new Map<string, { value: PendingWrite; expiresAt: number }>();

/**
 * Store a pending write operation and return a unique confirmation token.
 *
 * Uses Redis when available; falls back to an in-memory map otherwise.
 * TTL is in seconds.
 */
export async function storePendingWrite(
  redis: Redis | null,
  pending: PendingWrite,
  ttlSeconds: number,
): Promise<string> {
  const token = randomUUID();

  if (redis) {
    await redis.set(
      `${KEY_PREFIX}${token}`,
      JSON.stringify(pending),
      'EX',
      ttlSeconds,
    );
  } else {
    memoryStore.set(token, {
      value: pending,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  return token;
}

/**
 * Retrieve a pending write by its confirmation token.
 *
 * Returns null if the token is unknown, expired, or if retrieval fails.
 * Consumes the token — a token can only be used once (delete after read).
 */
export async function getPendingWrite(
  redis: Redis | null,
  token: string,
): Promise<PendingWrite | null> {
  if (redis) {
    try {
      const key = `${KEY_PREFIX}${token}`;
      const raw = await redis.get(key);
      if (!raw) return null;
      await redis.del(key);
      return JSON.parse(raw) as PendingWrite;
    } catch {
      return null;
    }
  }

  const entry = memoryStore.get(token);
  if (!entry) return null;

  memoryStore.delete(token);

  if (Date.now() > entry.expiresAt) return null;

  return entry.value;
}
