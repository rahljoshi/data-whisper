import OpenAI from 'openai';
import { config } from '../config';
import { AppError, ErrorType } from '../types/errors';

const SYSTEM_PROMPT = `You are a data analyst assistant. Given a PostgreSQL SELECT query, write exactly one plain-English sentence explaining what data it retrieves, what filters are applied, and how results are ordered or grouped. Be concise and non-technical. Do not start with "This query".`;

function getClient(): OpenAI {
  return new OpenAI({ apiKey: config.openai.apiKey });
}

/**
 * Generate a plain-English explanation of a SQL SELECT query.
 *
 * Returns a single descriptive sentence.
 * Throws AppError if the OpenAI call fails.
 */
export async function explainSql(sql: string): Promise<string> {
  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: config.openai.model,
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: sql },
      ],
    });

    const explanation = completion.choices[0]?.message?.content?.trim() ?? '';

    if (!explanation) {
      return 'Retrieves data from the database based on the specified criteria.';
    }

    return explanation;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new AppError(ErrorType.AI_UNAVAILABLE, `OpenAI explanation request failed: ${message}`);
  }
}
