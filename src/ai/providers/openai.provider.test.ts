/**
 * OpenAIProvider tests — mocks the OpenAI SDK at the module boundary.
 * No real API calls are made.
 */

jest.mock('openai');

import OpenAI from 'openai';
import { OpenAIProvider } from './openai.provider';
import { ErrorType } from '../../types/errors';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockOpenAIResponse(content: string) {
  const mockCreate = jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
    () => ({ chat: { completions: { create: mockCreate } } }) as unknown as OpenAI,
  );
  return mockCreate;
}

function mockOpenAIFailure(message: string) {
  const mockCreate = jest.fn().mockRejectedValue(new Error(message));
  (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
    () => ({ chat: { completions: { create: mockCreate } } }) as unknown as OpenAI,
  );
  return mockCreate;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('OpenAIProvider — constructor', () => {
  it('throws when apiKey is empty', () => {
    expect(() => new OpenAIProvider('')).toThrow('OPENAI_API_KEY');
  });

  it('exposes the correct provider name', () => {
    const provider = new OpenAIProvider('sk-test');
    expect(provider.name).toBe('openai');
  });

  it('uses the supplied model', () => {
    const provider = new OpenAIProvider('sk-test', 'gpt-4-turbo');
    expect(provider.model).toBe('gpt-4-turbo');
  });

  it('defaults model to gpt-4o', () => {
    const provider = new OpenAIProvider('sk-test');
    expect(provider.model).toBe('gpt-4o');
  });
});

// ── generateSQL — happy path ──────────────────────────────────────────────────

describe('OpenAIProvider.generateSQL — happy path', () => {
  it('returns the SQL from the LLM', async () => {
    mockOpenAIResponse('SELECT * FROM users LIMIT 100');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.generateSQL('CREATE TABLE users...', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('strips markdown code fences', async () => {
    mockOpenAIResponse('```sql\nSELECT * FROM users LIMIT 100\n```');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.generateSQL('CREATE TABLE users...', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('trims surrounding whitespace', async () => {
    mockOpenAIResponse('   SELECT * FROM users LIMIT 100   ');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.generateSQL('schema', 'users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('sends READ_ONLY system prompt containing SELECT restriction', async () => {
    const mockCreate = mockOpenAIResponse('SELECT 1');
    const provider = new OpenAIProvider('sk-test');
    await provider.generateSQL('schema', 'show users', 'READ_ONLY');

    const [call] = mockCreate.mock.calls as [{ messages: Array<{ role: string; content: string }> }][];
    const systemMsg = call[0].messages[0].content;
    expect(systemMsg).toMatch(/READ_ONLY/);
    expect(systemMsg).toMatch(/never.*insert|never.*update|never.*delete/i);
  });

  it('sends CRUD_ENABLED system prompt allowing writes', async () => {
    const mockCreate = mockOpenAIResponse('INSERT INTO users (name) VALUES (\'Alice\')');
    const provider = new OpenAIProvider('sk-test');
    await provider.generateSQL('schema', 'add user Alice', 'CRUD_ENABLED');

    const [call] = mockCreate.mock.calls as [{ messages: Array<{ role: string; content: string }> }][];
    const systemMsg = call[0].messages[0].content;
    expect(systemMsg).toMatch(/CRUD_ENABLED/);
    expect(systemMsg).toMatch(/insert|update|delete/i);
  });
});

// ── generateSQL — error paths ─────────────────────────────────────────────────

describe('OpenAIProvider.generateSQL — error paths', () => {
  it('throws AMBIGUOUS_QUERY on empty response', async () => {
    mockOpenAIResponse('');
    const provider = new OpenAIProvider('sk-test');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AMBIGUOUS_QUERY,
    });
  });

  it('throws AI_UNAVAILABLE on network error', async () => {
    mockOpenAIFailure('ECONNREFUSED');
    const provider = new OpenAIProvider('sk-test');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });

  it('returns CANNOT_ANSWER sentinel without throwing (caller handles it)', async () => {
    mockOpenAIResponse('CANNOT_ANSWER');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.generateSQL('schema', 'meaning of life', 'READ_ONLY');
    expect(result).toBe('CANNOT_ANSWER');
  });
});

// ── explainSQL ────────────────────────────────────────────────────────────────

describe('OpenAIProvider.explainSQL', () => {
  it('returns the explanation from the LLM', async () => {
    mockOpenAIResponse('Returns all users ordered by name.');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.explainSQL('SELECT * FROM users ORDER BY name LIMIT 100');
    expect(result).toBe('Returns all users ordered by name.');
  });

  it('returns empty string when LLM returns empty (caller handles fallback)', async () => {
    mockOpenAIResponse('');
    const provider = new OpenAIProvider('sk-test');
    const result = await provider.explainSQL('SELECT 1');
    expect(result).toBe('');
  });

  it('throws AI_UNAVAILABLE on SDK error', async () => {
    mockOpenAIFailure('timeout');
    const provider = new OpenAIProvider('sk-test');
    await expect(provider.explainSQL('SELECT 1')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });
});
