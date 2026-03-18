/**
 * GeminiProvider tests — mocks @google/generative-ai at the module boundary.
 * No real API calls are made.
 */

jest.mock('@google/generative-ai');

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiProvider } from './gemini.provider';
import { ErrorType } from '../../types/errors';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockGeminiResponse(text: string) {
  const mockGenerateContent = jest.fn().mockResolvedValue({
    response: { text: () => text },
  });

  const mockGetGenerativeModel = jest.fn().mockReturnValue({
    generateContent: mockGenerateContent,
  });

  (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(
    () => ({ getGenerativeModel: mockGetGenerativeModel }) as unknown as GoogleGenerativeAI,
  );

  return { mockGetGenerativeModel, mockGenerateContent };
}

function mockGeminiFailure(message: string) {
  const mockGenerateContent = jest.fn().mockRejectedValue(new Error(message));
  const mockGetGenerativeModel = jest.fn().mockReturnValue({ generateContent: mockGenerateContent });
  (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(
    () => ({ getGenerativeModel: mockGetGenerativeModel }) as unknown as GoogleGenerativeAI,
  );
  return { mockGetGenerativeModel, mockGenerateContent };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('GeminiProvider — constructor', () => {
  it('throws when apiKey is empty', () => {
    expect(() => new GeminiProvider('')).toThrow('GEMINI_API_KEY');
  });

  it('exposes the correct provider name', () => {
    const provider = new GeminiProvider('gm-test-key');
    expect(provider.name).toBe('gemini');
  });

  it('uses the supplied model', () => {
    const provider = new GeminiProvider('gm-test-key', 'gemini-1.5-flash');
    expect(provider.model).toBe('gemini-1.5-flash');
  });

  it('defaults model to gemini-1.5-pro', () => {
    const provider = new GeminiProvider('gm-test-key');
    expect(provider.model).toBe('gemini-1.5-pro');
  });
});

// ── generateSQL — happy path ──────────────────────────────────────────────────

describe('GeminiProvider.generateSQL — happy path', () => {
  it('returns SQL from the LLM', async () => {
    mockGeminiResponse('SELECT * FROM users LIMIT 100');
    const provider = new GeminiProvider('gm-test-key');
    const result = await provider.generateSQL('CREATE TABLE users...', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('strips markdown code fences', async () => {
    mockGeminiResponse('```sql\nSELECT * FROM users LIMIT 100\n```');
    const provider = new GeminiProvider('gm-test-key');
    const result = await provider.generateSQL('schema', 'show all users', 'READ_ONLY');
    expect(result).toBe('SELECT * FROM users LIMIT 100');
  });

  it('passes systemInstruction and the NL query to the model', async () => {
    const { mockGetGenerativeModel, mockGenerateContent } = mockGeminiResponse('SELECT 1');
    const provider = new GeminiProvider('gm-test-key');
    await provider.generateSQL('schema-ddl', 'show users', 'READ_ONLY');

    const modelOptions = (mockGetGenerativeModel.mock.calls[0] as [{ systemInstruction: string }])[0];
    expect(modelOptions.systemInstruction).toMatch(/READ_ONLY/);
    expect(mockGenerateContent).toHaveBeenCalledWith('show users');
  });

  it('uses CRUD_ENABLED system instruction when mode is CRUD_ENABLED', async () => {
    const { mockGetGenerativeModel } = mockGeminiResponse("INSERT INTO users (name) VALUES ('Alice')");
    const provider = new GeminiProvider('gm-test-key');
    await provider.generateSQL('schema', 'add user Alice', 'CRUD_ENABLED');

    const modelOptions = (mockGetGenerativeModel.mock.calls[0] as [{ systemInstruction: string }])[0];
    expect(modelOptions.systemInstruction).toMatch(/CRUD_ENABLED/);
  });
});

// ── generateSQL — error paths ─────────────────────────────────────────────────

describe('GeminiProvider.generateSQL — error paths', () => {
  it('throws AMBIGUOUS_QUERY on empty response', async () => {
    mockGeminiResponse('');
    const provider = new GeminiProvider('gm-test-key');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AMBIGUOUS_QUERY,
    });
  });

  it('throws AI_UNAVAILABLE on SDK error', async () => {
    mockGeminiFailure('RESOURCE_EXHAUSTED');
    const provider = new GeminiProvider('gm-test-key');
    await expect(provider.generateSQL('schema', 'query', 'READ_ONLY')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });

  it('returns CANNOT_ANSWER sentinel without throwing (caller handles it)', async () => {
    mockGeminiResponse('CANNOT_ANSWER');
    const provider = new GeminiProvider('gm-test-key');
    const result = await provider.generateSQL('schema', 'meaning of life', 'READ_ONLY');
    expect(result).toBe('CANNOT_ANSWER');
  });
});

// ── explainSQL ────────────────────────────────────────────────────────────────

describe('GeminiProvider.explainSQL', () => {
  it('returns the explanation from the LLM', async () => {
    mockGeminiResponse('Retrieves all orders placed in the last 7 days.');
    const provider = new GeminiProvider('gm-test-key');
    const result = await provider.explainSQL("SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days' LIMIT 100");
    expect(result).toBe('Retrieves all orders placed in the last 7 days.');
  });

  it('returns empty string when LLM returns empty (caller handles fallback)', async () => {
    mockGeminiResponse('');
    const provider = new GeminiProvider('gm-test-key');
    const result = await provider.explainSQL('SELECT 1');
    expect(result).toBe('');
  });

  it('throws AI_UNAVAILABLE on SDK error', async () => {
    mockGeminiFailure('quota exceeded');
    const provider = new GeminiProvider('gm-test-key');
    await expect(provider.explainSQL('SELECT 1')).rejects.toMatchObject({
      type: ErrorType.AI_UNAVAILABLE,
    });
  });
});
