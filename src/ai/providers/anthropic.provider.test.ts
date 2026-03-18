/**
 * AnthropicProvider tests — mocks @anthropic-ai/sdk at the module boundary.
 * No real API calls are made.
 */

jest.mock('@anthropic-ai/sdk');

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.provider';
import { ErrorType } from '../../types/errors';

// ── Helpers ───────────────────────────────────────────────────────────────────

type AnthropicMessage = { content: Array<{ type: string; text: string }> };

function mockAnthropicResponse(text: string) {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text }],
  } as AnthropicMessage);

  (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
  );

  return mockCreate;
}

function mockAnthropicFailure(message: string) {
  const mockCreate = jest.fn().mockRejectedValue(new Error(message));
  (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
  );
  return mockCreate;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('AnthropicProvider — constructor', () => {
  it('throws when apiKey is empty', () => {
    expect(() => new AnthropicProvider('')).toThrow('ANTHROPIC_API_KEY');
  });

  it('exposes the correct provider name', () => {
    const provider = new AnthropicProvider('sk-ant-test');
    expect(provider.name).toBe('anthropic');
  });

  it('uses the supplied model', () => {
    const provider = new AnthropicProvider('sk-ant-test', 'claude-3-opus-20240229');
    expect(provider.model).toBe('claude-3-opus-20240229');
  });

  it('defaults model to claude-sonnet-4-20250514', () => {
    const provider = new AnthropicProvider('sk-ant-test');
    expect(provider.model).toBe('claude-sonnet-4-20250514');
  });
});

// ── generateSQL — happy path ──────────────────────────────────────────────────

describe('AnthropicProvider.generateSQL — happy path', () => {
  it('returns SQL from the LLM', async () => {
    mockAnthropicResponse('SELECT * FROM users LIMIT 100');
    const provider = new AnthropicProvider('sk-ant-test');
    const result = await provider.generateSQL('CREATE TABLE users...', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('strips markdown code fences', async () => {
    mockAnthropicResponse('```sql\nSELECT * FROM users LIMIT 100\n```');
    const provider = new AnthropicProvider('sk-ant-test');
    const result = await provider.generateSQL('schema', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('sends system prompt as the `system` parameter (Anthropic style)', async () => {
    const mockCreate = mockAnthropicResponse('SELECT 1');
    const provider = new AnthropicProvider('sk-ant-test');
    await provider.generateSQL('schema', 'show users', 'READ_ONLY');

    const [call] = mockCreate.mock.calls as [{ system: string; messages: Array<{ content: string }> }][];
    expect(call[0].system).toMatch(/READ_ONLY/);
    expect(call[0].messages[0].content).toBe('show users');
  });

  it('sends CRUD_ENABLED system prompt when mode is CRUD_ENABLED', async () => {
    const mockCreate = mockAnthropicResponse('INSERT INTO users (name) VALUES (\'Alice\')');
    const provider = new AnthropicProvider('sk-ant-test');
    await provider.generateSQL('schema', 'add user Alice', 'CRUD_ENABLED');

    const [call] = mockCreate.mock.calls as [{ system: string }][];
    expect(call[0].system).toMatch(/CRUD_ENABLED/);
  });
});

// ── generateSQL — error paths ─────────────────────────────────────────────────

describe('AnthropicProvider.generateSQL — error paths', () => {
  it('throws AMBIGUOUS_QUERY on empty response', async () => {
    mockAnthropicResponse('');
    const provider = new AnthropicProvider('sk-ant-test');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AMBIGUOUS_QUERY,
    });
  });

  it('throws AI_UNAVAILABLE on SDK error', async () => {
    mockAnthropicFailure('overloaded_error');
    const provider = new AnthropicProvider('sk-ant-test');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });

  it('returns CANNOT_ANSWER sentinel without throwing (caller handles it)', async () => {
    mockAnthropicResponse('CANNOT_ANSWER');
    const provider = new AnthropicProvider('sk-ant-test');
    const result = await provider.generateSQL('schema', 'meaning of life', 'READ_ONLY');
    expect(result).toBe('CANNOT_ANSWER');
  });
});

// ── explainSQL ────────────────────────────────────────────────────────────────

describe('AnthropicProvider.explainSQL', () => {
  it('returns the explanation from the LLM', async () => {
    mockAnthropicResponse('Returns all active users sorted by signup date.');
    const provider = new AnthropicProvider('sk-ant-test');
    const result = await provider.explainSQL('SELECT * FROM users WHERE active = true ORDER BY created_at LIMIT 100');
    expect(result).toBe('Returns all active users sorted by signup date.');
  });

  it('returns empty string when LLM returns empty (caller handles fallback)', async () => {
    mockAnthropicResponse('');
    const provider = new AnthropicProvider('sk-ant-test');
    const result = await provider.explainSQL('SELECT 1');
    expect(result).toBe('');
  });

  it('throws AI_UNAVAILABLE on SDK error', async () => {
    mockAnthropicFailure('rate_limit_error');
    const provider = new AnthropicProvider('sk-ant-test');
    await expect(provider.explainSQL('SELECT 1')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });
});
