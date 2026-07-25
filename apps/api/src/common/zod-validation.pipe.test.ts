import { BadRequestException } from '@nestjs/common';
import { cartLineInputSchema, productQuerySchema } from '@shop/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  it('returns the parsed value on success', () => {
    const pipe = new ZodValidationPipe(cartLineInputSchema);
    expect(pipe.transform({ variantId: 'v1', quantity: 2 })).toEqual({
      variantId: 'v1',
      quantity: 2,
    });
  });

  it('applies coercion and defaults from the schema', () => {
    const pipe = new ZodValidationPipe(productQuerySchema);
    expect(pipe.transform({ page: '3' })).toMatchObject({ page: 3, perPage: 12, sort: 'newest' });
  });

  it('throws 400 rather than letting bad input through', () => {
    const pipe = new ZodValidationPipe(cartLineInputSchema);
    expect(() => pipe.transform({ variantId: 'v1', quantity: 0 })).toThrow(BadRequestException);
  });

  it('reports the failing path so the client knows which field is wrong', () => {
    const pipe = new ZodValidationPipe(cartLineInputSchema);
    try {
      pipe.transform({ variantId: 'v1', quantity: -1 });
      expect.unreachable('should have thrown');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        message: string;
        issues: Array<{ path: (string | number)[]; message: string }>;
      };
      expect(response.message).toBe('Validation failed');
      expect(response.issues[0]?.path).toEqual(['quantity']);
    }
  });

  it('reports every failing field, not only the first', () => {
    const pipe = new ZodValidationPipe(
      z.object({ a: z.string(), b: z.number(), c: z.boolean() }),
    );
    try {
      pipe.transform({ a: 1, b: 'x', c: 'y' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        issues: Array<{ path: (string | number)[] }>;
      };
      expect(response.issues).toHaveLength(3);
    }
  });

  it('rejects null and undefined instead of coercing them to an empty object', () => {
    const pipe = new ZodValidationPipe(cartLineInputSchema);
    expect(() => pipe.transform(null)).toThrow(BadRequestException);
    expect(() => pipe.transform(undefined)).toThrow(BadRequestException);
  });

  it('strips unknown keys, so a client cannot smuggle extra fields into a write', () => {
    const pipe = new ZodValidationPipe(cartLineInputSchema);
    expect(pipe.transform({ variantId: 'v1', quantity: 1, role: 'ADMIN' })).toEqual({
      variantId: 'v1',
      quantity: 1,
    });
  });
});
