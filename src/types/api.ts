export type QueryMode = 'READ_ONLY' | 'CRUD_ENABLED';

export interface QueryRequest {
  query: string;
  /** Optional LLM provider override. Falls back to LLM_PROVIDER env var. */
  provider?: 'openai' | 'anthropic' | 'gemini';
}

export interface ConfirmWriteRequest {
  token: string;
}

export interface QueryResponse {
  query: string;
  explanation: string;
  data: Record<string, unknown>[];
  row_count: number;
  type: 'READ' | 'WRITE';
  affected_rows?: number;
  /** LLM provider that generated the SQL, e.g. 'anthropic' */
  provider?: string;
  /** Exact model used, e.g. 'claude-sonnet-4-20250514' */
  model?: string;
}

export interface WriteImpact {
  affected_rows: number;
  preview: Record<string, unknown>[];
  warning: string;
}

export interface WriteConfirmationResponse {
  status: 'AWAITING_CONFIRMATION';
  type: 'WRITE';
  operation: 'DELETE' | 'UPDATE';
  impact: WriteImpact;
  query: string;
  explanation: string;
  confirmation_token: string;
  confirm_to_proceed: string;
}

export interface ErrorResponse {
  error: {
    type: string;
    message: string;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  services: {
    database: 'connected' | 'error';
    redis: 'connected' | 'error' | 'disabled';
  };
}
