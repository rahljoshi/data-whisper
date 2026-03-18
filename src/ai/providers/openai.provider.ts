import OpenAI from 'openai';
import type { LLMProvider } from '../provider.interface';
import { AppError, ErrorType } from '../../types/errors';
import { buildSQLSystemPrompt, EXPLAIN_SYSTEM_PROMPT, stripCodeFences } from '../prompts';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(apiKey: string, model = 'gpt-4o', maxTokens = 512, temperature = 0) {
    if (!apiKey) {
      throw new Error('OpenAI provider requires OPENAI_API_KEY');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  private getClient(): OpenAI {
    return new OpenAI({ apiKey: this.apiKey });
  }

  async generateSQL(schema: string, nlQuery: string, mode: string): Promise<string> {
    const systemPrompt = buildSQLSystemPrompt(mode, schema);

    let rawResponse: string;
    try {
      const client = this.getClient();
      const completion = await client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: nlQuery },
        ],
      });
      rawResponse = completion.choices[0]?.message?.content?.trim() ?? '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(ErrorType.AI_UNAVAILABLE, `OpenAI request failed: ${message}`);
    }

    if (!rawResponse) {
      throw new AppError(ErrorType.AMBIGUOUS_QUERY, 'OpenAI returned an empty response');
    }

    return stripCodeFences(rawResponse);
  }

  async explainSQL(sql: string): Promise<string> {
    try {
      const client = this.getClient();
      const completion = await client.chat.completions.create({
        model: this.model,
        max_tokens: 256,
        temperature: 0,
        messages: [
          { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
          { role: 'user', content: sql },
        ],
      });
      return completion.choices[0]?.message?.content?.trim() ?? '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(ErrorType.AI_UNAVAILABLE, `OpenAI explanation request failed: ${message}`);
    }
  }
}
