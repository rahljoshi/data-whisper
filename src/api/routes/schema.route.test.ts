import Fastify from 'fastify';
import { schemaVersionRoutes } from './schema.route';
import * as schemaService from '../../schema/schemaService';

jest.mock('../../schema/schemaService');

describe('GET /api/schema/version', () => {
  beforeEach(() => {
    jest.mocked(schemaService.getSchemaSnapshot).mockReturnValue({
      schema: new Map(),
      version: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      loadedAt: new Date('2024-01-15T10:00:00Z'),
    });
    jest.mocked(schemaService.getSchemaTableCount).mockReturnValue(8);
  });

  it('returns hash, table_count, and last_updated', async () => {
    const app = Fastify({ logger: false });
    await app.register(schemaVersionRoutes, { redis: null });

    const resp = await app.inject({ method: 'GET', url: '/api/schema/version' });

    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ hash: string; table_count: number; last_updated: string }>();
    expect(body.hash).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abc1');
    expect(body.table_count).toBe(8);
    expect(body.last_updated).toBe('2024-01-15T10:00:00.000Z');
  });

  it('uses full SHA-256 hash (64 hex chars)', async () => {
    const app = Fastify({ logger: false });
    await app.register(schemaVersionRoutes, { redis: null });

    const resp = await app.inject({ method: 'GET', url: '/api/schema/version' });
    const body = resp.json<{ hash: string }>();
    expect(body.hash).toHaveLength(64);
  });
});
