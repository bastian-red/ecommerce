import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates and coerces input against a Zod contract from `@shop/shared`,
 * throwing 400 with the failing paths on mismatch.
 *
 * Nest's own ValidationPipe and class-validator are deliberately not used: the
 * contract already exists as a Zod schema shared with the web app, and a second
 * decorator-based definition of the same shape is a second thing to keep in
 * sync.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
