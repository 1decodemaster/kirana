import { z } from 'zod';
import { httpError } from './plugins/errors.js';

/** Boundary validation (AGENTS §5): every request body/param goes through Zod. */
export function parseRequest<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw httpError(400, 'VALIDATION_FAILED', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  }
  return result.data;
}
