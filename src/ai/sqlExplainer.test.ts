/**
 * sqlExplainer tests mock the OpenAI SDK at the module boundary.
 */
jest.mock('openai');

import OpenAI from 'openai';
import { explainSql } from './sqlExplainer';
import { AppError, ErrorType } from '../types/errors';

function mockOpenAIResponse(content: string) {
  const mockCreate = jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });

  (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
    () => ({ chat: { completions: { create: mockCreate } } }) as unknown as OpenAI,
  );

  return mockCreate;
}

beforeEach(() => {
  jest.clearAllMocks();
});

const sampleSql = 'SELECT id, name FROM users ORDER BY name ASC LIMIT 100';

// ── Happy path ────────────────────────────────────────────────────────────────

describe('explainSql — happy path', () => {
  it('returns the explanation string from the LLM', async () => {
    const expected = 'Retrieves the names and IDs of all users sorted alphabetically.';
    mockOpenAIResponse(expected);

    const result = await explainSql(sampleSql);
    expect(result).toBe(expected);
  });

  it('trims whitespace from the LLM response', async () => {
    mockOpenAIResponse('  Some explanation.  ');

    const result = await explainSql(sampleSql);
    expect(result).toBe('Some explanation.');
  });
});

// ── Empty response fallback ───────────────────────────────────────────────────

describe('explainSql — empty response', () => {
  it('returns a generic fallback when LLM returns empty content', async () => {
    mockOpenAIResponse('');

    const result = await explainSql(sampleSql);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

// ── OpenAI failure ────────────────────────────────────────────────────────────

describe('explainSql — OpenAI errors', () => {
  it('throws AI_UNAVAILABLE when the OpenAI call fails', async () => {
    const mockCreate = jest.fn().mockRejectedValue(new Error('timeout'));

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
      () => ({ chat: { completions: { create: mockCreate } } }) as unknown as OpenAI,
    );

    expect.assertions(2);
    try {
      await explainSql(sampleSql);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).type).toBe(ErrorType.AI_UNAVAILABLE);
    }
  });
});
