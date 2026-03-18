import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const configSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // PostgreSQL
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('postgres'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default(''),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_MAX_TOKENS: z.coerce.number().int().positive().default(512),
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),

  // Query Engine
  QUERY_MODE: z.enum(['READ_ONLY', 'CRUD_ENABLED']).default('READ_ONLY'),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  QUERY_MAX_ROWS: z.coerce.number().int().positive().default(100),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SCHEMA_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(600000),
  PENDING_WRITE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Security
  MAX_QUESTION_LENGTH: z.coerce.number().int().positive().default(2000),
  SENSITIVE_COLUMN_PATTERNS: z
    .string()
    .default('password,password_hash,secret,token,api_key,private_key,salt,otp,ssn,credit_card'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

  // Schema
  DB_SCHEMAS: z.string().default('public'),

  // Query Cost Estimation
  QUERY_COST_THRESHOLD: z.coerce.number().positive().default(10000),
  SEQ_SCAN_ROW_THRESHOLD: z.coerce.number().int().positive().default(100000),
});

function loadConfig() {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${formatted}`);
  }
  return result.data;
}

const raw = loadConfig();

export const config = {
  server: {
    port: raw.PORT,
    host: raw.HOST,
    isDev: raw.NODE_ENV === 'development',
    isTest: raw.NODE_ENV === 'test',
    nodeEnv: raw.NODE_ENV,
  },
  db: {
    connectionString: raw.DATABASE_URL,
    host: raw.DB_HOST,
    port: raw.DB_PORT,
    database: raw.DB_NAME,
    user: raw.DB_USER,
    password: raw.DB_PASSWORD,
    poolMax: raw.DB_POOL_MAX,
    idleTimeoutMillis: raw.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: raw.DB_CONNECTION_TIMEOUT_MS,
    schemas: raw.DB_SCHEMAS.split(',').map((s) => s.trim()),
  },
  redis: {
    url: raw.REDIS_URL,
    password: raw.REDIS_PASSWORD,
    tls: raw.REDIS_TLS,
  },
  openai: {
    apiKey: raw.OPENAI_API_KEY,
    model: raw.OPENAI_MODEL,
    maxTokens: raw.OPENAI_MAX_TOKENS,
    temperature: raw.OPENAI_TEMPERATURE,
  },
  query: {
    mode: raw.QUERY_MODE,
    timeoutMs: raw.QUERY_TIMEOUT_MS,
    maxRows: raw.QUERY_MAX_ROWS,
    cacheTtlSeconds: raw.CACHE_TTL_SECONDS,
    schemaRefreshIntervalMs: raw.SCHEMA_REFRESH_INTERVAL_MS,
    pendingWriteTtlSeconds: raw.PENDING_WRITE_TTL_SECONDS,
  },
  security: {
    maxQuestionLength: raw.MAX_QUESTION_LENGTH,
    sensitiveColumnPatterns: raw.SENSITIVE_COLUMN_PATTERNS.split(',').map((s) =>
      s.trim().toLowerCase(),
    ),
  },
  rateLimit: {
    max: raw.RATE_LIMIT_MAX,
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
  },
  costEstimation: {
    queryCostThreshold: raw.QUERY_COST_THRESHOLD,
    seqScanRowThreshold: raw.SEQ_SCAN_ROW_THRESHOLD,
  },
} as const;

export type Config = typeof config;
