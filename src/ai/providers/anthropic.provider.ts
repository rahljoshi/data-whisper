import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../provider.interface';
import { AppError, ErrorType } from '../../types/errors';
import { buildSQLSystemPrompt, EXPLAIN_SYSTEM_PROMPT, stripCodeFences } from '../prompts';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;

  private readonly apiKey: string;
  private readonly maxTokens: number;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514', maxTokens = 512) {
    if (!apiKey) {
      throw new Error('Anthropic provider requires ANTHROPIC_API_KEY');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  private getClient(): Anthropic {
    return new Anthropic({ apiKey: this.apiKey });
  }

  async generateSQL(schema: string, nlQuery: string, mode: string): Promise<string> {
    const systemPrompt = buildSQLSystemPrompt(mode, schema);

    let rawResponse: string;
    try {
      const client = this.getClient();
      const message = await client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: nlQuery }],
      });

      const block = message.content[0];
      rawResponse = block?.type === 'text' ? block.text.trim() : '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(ErrorType.AI_UNAVAILABLE, `Anthropic request failed: ${message}`);
    }

    if (!rawResponse) {
      throw new AppError(ErrorType.AMBIGUOUS_QUERY, 'Anthropic returned an empty response');
    }

    return stripCodeFences(rawResponse);
  }

  async explainSQL(sql: string): Promise<string> {
    try {
      const client = this.getClient();
      const message = await client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: EXPLAIN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: sql }],
      });

      const block = message.content[0];
      return block?.type === 'text' ? block.text.trim() : '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(
        ErrorType.AI_UNAVAILABLE,
        `Anthropic explanation request failed: ${message}`,
      );
    }
  }
}
