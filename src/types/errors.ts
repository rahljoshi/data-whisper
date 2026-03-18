export const ErrorType = {
  INVALID_SQL: 'INVALID_SQL',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  AMBIGUOUS_QUERY: 'AMBIGUOUS_QUERY',
  TIMEOUT: 'TIMEOUT',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  WRITE_NOT_ALLOWED: 'WRITE_NOT_ALLOWED',
  MISSING_WHERE_CLAUSE: 'MISSING_WHERE_CLAUSE',
  // RBAC
  TABLE_ACCESS_DENIED: 'TABLE_ACCESS_DENIED',
  CRUD_NOT_ALLOWED: 'CRUD_NOT_ALLOWED',
  USER_CONTEXT_MISSING: 'USER_CONTEXT_MISSING',
  // Cost estimation
  QUERY_TOO_EXPENSIVE: 'QUERY_TOO_EXPENSIVE',
  // History / feedback
  HISTORY_NOT_FOUND: 'HISTORY_NOT_FOUND',
  FEEDBACK_ALREADY_SUBMITTED: 'FEEDBACK_ALREADY_SUBMITTED',
  INVALID_FEEDBACK_VALUE: 'INVALID_FEEDBACK_VALUE',
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;

  constructor(type: ErrorType, message: string) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.statusCode = AppError.statusCodeFor(type);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  private static statusCodeFor(type: ErrorType): number {
    switch (type) {
      case ErrorType.INVALID_SQL:
      case ErrorType.SCHEMA_MISMATCH:
      case ErrorType.SCHEMA_VIOLATION:
      case ErrorType.AMBIGUOUS_QUERY:
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.MISSING_WHERE_CLAUSE:
        return 400;
      case ErrorType.WRITE_NOT_ALLOWED:
        return 403;
      case ErrorType.TIMEOUT:
        return 504;
      case ErrorType.AI_UNAVAILABLE:
        return 502;
      case ErrorType.TABLE_ACCESS_DENIED:
      case ErrorType.CRUD_NOT_ALLOWED:
        return 403;
      case ErrorType.USER_CONTEXT_MISSING:
        return 401;
      case ErrorType.QUERY_TOO_EXPENSIVE:
        return 400;
      case ErrorType.HISTORY_NOT_FOUND:
        return 404;
      case ErrorType.FEEDBACK_ALREADY_SUBMITTED:
      case ErrorType.INVALID_FEEDBACK_VALUE:
        return 400;
      case ErrorType.EXECUTION_ERROR:
      case ErrorType.INTERNAL_ERROR:
        return 500;
    }
  }

  toJSON(): { error: { type: ErrorType; message: string } } {
    return {
      error: {
        type: this.type,
        message: this.message,
      },
    };
  }
}
