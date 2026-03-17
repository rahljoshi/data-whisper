export const ErrorType = {
  INVALID_SQL: 'INVALID_SQL',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  AMBIGUOUS_QUERY: 'AMBIGUOUS_QUERY',
  TIMEOUT: 'TIMEOUT',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
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
      case ErrorType.AMBIGUOUS_QUERY:
      case ErrorType.VALIDATION_ERROR:
        return 400;
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
