import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_TRANSITIONS,
  addressSchema,
  adminVariantInputSchema,
  canTransitionOrder,
  cartLineInputSchema,
  checkoutInputSchema,
  isTerminalOrderStatus,
  orderStatusSchema,
  productQuerySchema,
  slugSchema,
  stockChangeSchema,
  type OrderStatus,
} from './index';

describe('slugSchema', () => {
  it('accepts kebab-case', () => {
    expect(slugSchema.safeParse('ear-one').success).toBe(true);
    expect(slugSchema.safeParse('usb-c-cable-15').success).toBe(true);
  });

  it('rejects uppercase, spaces and edge dashes', () => {
    for (const bad of ['Ear One', 'ear_one', '-ear', 'ear-', 'ear--one', '']) {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('order status transitions', () => {
  it('allows the happy path', () => {
    expect(canTransitionOrder('PENDING', 'PAID')).toBe(true);
    expect(canTransitionOrder('PAID', 'FULFILLED')).toBe(true);
  });

  it('refuses to walk an order backwards, which is what a replayed webhook tries', () => {
    expect(canTransitionOrder('PAID', 'PENDING')).toBe(false);
    expect(canTransitionOrder('FULFILLED', 'PAID')).toBe(false);
    expect(canTransitionOrder('PAID', 'PAID')).toBe(false);
  });

  it('refuses to revive a closed order', () => {
    expect(canTransitionOrder('EXPIRED', 'PAID')).toBe(false);
    expect(canTransitionOrder('CANCELLED', 'PAID')).toBe(false);
  });

  it('marks exactly the closed statuses terminal', () => {
    expect(isTerminalOrderStatus('FULFILLED')).toBe(true);
    expect(isTerminalOrderStatus('CANCELLED')).toBe(true);
    expect(isTerminalOrderStatus('EXPIRED')).toBe(true);
    expect(isTerminalOrderStatus('PENDING')).toBe(false);
    expect(isTerminalOrderStatus('PAID')).toBe(false);
  });

  it('covers every status in the enum, so a new one cannot be forgotten', () => {
    for (const status of orderStatusSchema.options) {
      expect(ORDER_STATUS_TRANSITIONS[status as OrderStatus]).toBeDefined();
    }
  });

  it('never points at a status outside the enum', () => {
    const valid = new Set<string>(orderStatusSchema.options);
    for (const targets of Object.values(ORDER_STATUS_TRANSITIONS)) {
      for (const target of targets) expect(valid.has(target)).toBe(true);
    }
  });

  it('has no self-transitions, so idempotent replay is always a no-op', () => {
    for (const status of orderStatusSchema.options) {
      expect(canTransitionOrder(status as OrderStatus, status as OrderStatus)).toBe(false);
    }
  });
});

describe('productQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = productQuerySchema.parse({});
    expect(parsed).toMatchObject({ sort: 'newest', page: 1, perPage: 12 });
  });

  it('coerces query-string numbers, which arrive as strings', () => {
    const parsed = productQuerySchema.parse({ page: '3', perPage: '24' });
    expect(parsed.page).toBe(3);
    expect(parsed.perPage).toBe(24);
  });

  it('rejects an inverted price range', () => {
    const result = productQuerySchema.safeParse({ minPriceCents: 5000, maxPriceCents: 1000 });
    expect(result.success).toBe(false);
  });

  it('accepts an equal price range', () => {
    expect(
      productQuerySchema.safeParse({ minPriceCents: 1000, maxPriceCents: 1000 }).success,
    ).toBe(true);
  });

  it('caps perPage so a client cannot ask for the whole catalog', () => {
    expect(productQuerySchema.safeParse({ perPage: 1000 }).success).toBe(false);
  });
});

describe('cartLineInputSchema', () => {
  it('rejects a zero or fractional quantity', () => {
    expect(cartLineInputSchema.safeParse({ variantId: 'v1', quantity: 0 }).success).toBe(false);
    expect(cartLineInputSchema.safeParse({ variantId: 'v1', quantity: 1.5 }).success).toBe(false);
  });

  it('rejects a quantity above the line cap', () => {
    expect(cartLineInputSchema.safeParse({ variantId: 'v1', quantity: 100 }).success).toBe(false);
  });
});

describe('addressSchema', () => {
  it('upper-cases the country code', () => {
    const parsed = addressSchema.parse({
      name: 'A Buyer',
      line1: '1 Test St',
      city: 'Santiago',
      postalCode: '8320000',
      country: 'cl',
    });
    expect(parsed.country).toBe('CL');
  });

  it('rejects a three-letter country code', () => {
    const result = addressSchema.safeParse({
      name: 'A Buyer',
      line1: '1 Test St',
      city: 'Santiago',
      postalCode: '8320000',
      country: 'CHL',
    });
    expect(result.success).toBe(false);
  });
});

describe('checkoutInputSchema', () => {
  it('requires a valid email and a complete address', () => {
    expect(
      checkoutInputSchema.safeParse({
        email: 'not-an-email',
        shippingAddress: {
          name: 'A',
          line1: 'B',
          city: 'C',
          postalCode: 'D',
          country: 'CL',
        },
      }).success,
    ).toBe(false);
  });
});

describe('adminVariantInputSchema', () => {
  it('accepts a conventional SKU', () => {
    expect(adminVariantInputSchema.safeParse({ sku: 'EAR1-WHT', name: 'White', priceCents: 100 }).success).toBe(
      true,
    );
  });

  it('rejects a lowercase or dash-leading SKU', () => {
    expect(adminVariantInputSchema.safeParse({ sku: 'ear1-wht', name: 'W', priceCents: 1 }).success).toBe(
      false,
    );
    expect(adminVariantInputSchema.safeParse({ sku: '-EAR', name: 'W', priceCents: 1 }).success).toBe(
      false,
    );
  });

  it('rejects a negative price', () => {
    expect(adminVariantInputSchema.safeParse({ sku: 'A', name: 'W', priceCents: -1 }).success).toBe(
      false,
    );
  });
});

describe('stockChangeSchema', () => {
  it('accepts a signed adjustment', () => {
    expect(stockChangeSchema.parse({ kind: 'ADJUST', quantity: -3 })).toMatchObject({
      kind: 'ADJUST',
      quantity: -3,
      reason: '',
    });
  });

  it('rejects a fractional quantity', () => {
    expect(stockChangeSchema.safeParse({ kind: 'RESTOCK', quantity: 1.5 }).success).toBe(false);
  });
});
