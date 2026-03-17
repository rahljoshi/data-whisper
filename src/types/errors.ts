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
