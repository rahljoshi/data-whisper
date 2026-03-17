import { AppError, ErrorType } from './errors';

describe('AppError', () => {
  describe('HTTP status code mapping', () => {
    it('maps INVALID_SQL to 400', () => {
      const err = new AppError(ErrorType.INVALID_SQL, 'bad sql');
      expect(err.statusCode).toBe(400);
    });

    it('maps SCHEMA_MISMATCH to 400', () => {
      const err = new AppError(ErrorType.SCHEMA_MISMATCH, 'unknown table');
      expect(err.statusCode).toBe(400);
    });

    it('maps AMBIGUOUS_QUERY to 400', () => {
      const err = new AppError(ErrorType.AMBIGUOUS_QUERY, 'cannot answer');
      expect(err.statusCode).toBe(400);
    });

    it('maps VALIDATION_ERROR to 400', () => {
      const err = new AppError(ErrorType.VALIDATION_ERROR, 'invalid input');
      expect(err.statusCode).toBe(400);
    });

    it('maps TIMEOUT to 504', () => {
      const err = new AppError(ErrorType.TIMEOUT, 'query timed out');
      expect(err.statusCode).toBe(504);
    });

    it('maps AI_UNAVAILABLE to 502', () => {
      const err = new AppError(ErrorType.AI_UNAVAILABLE, 'openai down');
      expect(err.statusCode).toBe(502);
    });

    it('maps EXECUTION_ERROR to 500', () => {
      const err = new AppError(ErrorType.EXECUTION_ERROR, 'db error');
      expect(err.statusCode).toBe(500);
    });

    it('maps INTERNAL_ERROR to 500', () => {
      const err = new AppError(ErrorType.INTERNAL_ERROR, 'unexpected');
      expect(err.statusCode).toBe(500);
    });
  });

  describe('toJSON()', () => {
    it('returns structured { error: { type, message } }', () => {
      const err = new AppError(ErrorType.INVALID_SQL, 'DELETE is not allowed');

      expect(err.toJSON()).toEqual({
        error: {
          type: 'INVALID_SQL',
          message: 'DELETE is not allowed',
        },
      });
    });

    it('preserves the error message exactly', () => {
      const message = 'Table "orders" does not exist in the schema';
      const err = new AppError(ErrorType.SCHEMA_MISMATCH, message);
      expect(err.toJSON().error.message).toBe(message);
    });
  });

  describe('instanceof checks', () => {
    it('is an instance of Error', () => {
      const err = new AppError(ErrorType.TIMEOUT, 'timeout');
      expect(err).toBeInstanceOf(Error);
    });

    it('is an instance of AppError', () => {
      const err = new AppError(ErrorType.TIMEOUT, 'timeout');
      expect(err).toBeInstanceOf(AppError);
    });

    it('has name set to AppError', () => {
      const err = new AppError(ErrorType.INVALID_SQL, 'bad');
      expect(err.name).toBe('AppError');
    });
  });
});
