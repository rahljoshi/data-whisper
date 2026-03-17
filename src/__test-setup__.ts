/**
 * Jest global setup — sets required environment variables so that
 * config.ts passes Zod validation during test runs without a real .env file.
 */
process.env['OPENAI_API_KEY'] = 'sk-test-key-for-unit-tests';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/testdb';
process.env['REDIS_URL'] = 'redis://localhost:6379';
