import type { ZodType, ZodTypeDef } from 'zod';
import { validationError } from './errors.js';

/** Parses untrusted input with a zod schema, raising a 400 envelope with field issues on failure. */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
