import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider } from '../provider.interface';
import { AppError, ErrorType } from '../../types/errors';
import { buildSQLSystemPrompt, EXPLAIN_SYSTEM_PROMPT, stripCodeFences } from '../prompts';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;

  private readonly apiKey: string;
  private readonly maxTokens: number;

  constructor(apiKey: string, model = 'gemini-1.5-pro', maxTokens = 512) {
    if (!apiKey) {
      throw new Error('Gemini provider requires GEMINI_API_KEY');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  private getClient(): GoogleGenerativeAI {
    return new GoogleGenerativeAI(this.apiKey);
  }

  async generateSQL(schema: string, nlQuery: string, mode: string): Promise<string> {
    const systemInstruction = buildSQLSystemPrompt(mode, schema);

    let rawResponse: string;
    try {
      const genAI = this.getClient();
      const geminiModel = genAI.getGenerativeModel({
        model: this.model,
        systemInstruction,
        generationConfig: { maxOutputTokens: this.maxTokens, temperature: 0 },
      });

      const result = await geminiModel.generateContent(nlQuery);
      rawResponse = result.response.text().trim();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(ErrorType.AI_UNAVAILABLE, `Gemini request failed: ${message}`);
    }

    if (!rawResponse) {
      throw new AppError(ErrorType.AMBIGUOUS_QUERY, 'Gemini returned an empty response');
    }

    return stripCodeFences(rawResponse);
  }

  async explainSQL(sql: string): Promise<string> {
    try {
      const genAI = this.getClient();
      const geminiModel = genAI.getGenerativeModel({
        model: this.model,
        systemInstruction: EXPLAIN_SYSTEM_PROMPT,
        generationConfig: { maxOutputTokens: 256, temperature: 0 },
      });

      const result = await geminiModel.generateContent(sql);
      return result.response.text().trim();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError(ErrorType.AI_UNAVAILABLE, `Gemini explanation request failed: ${message}`);
    }
  }
}
