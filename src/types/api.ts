export interface QueryRequest {
  question: string;
}

export interface QueryResponse {
  query: string;
  explanation: string;
  data: Record<string, unknown>[];
  row_count: number;
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
