import { describe, expect, it } from 'vitest';
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  formatMoney,
  lineTotalCents,
  priceCart,
  roundHalfAwayFromZero,
  shippingCents,
  subtotalCents,
  taxCents,
  type PricingPolicy,
} from './pricing';

const policy: PricingPolicy = {
  taxBasisPoints: 875, // 8.75%
  freeShippingThresholdCents: 5_000,
  shippingFlatCents: 599,
};

describe('lineTotalCents', () => {
  it('multiplies price by quantity', () => {
    expect(lineTotalCents(14_900, 3)).toBe(44_700);
  });

  it('allows a free item', () => {
    expect(lineTotalCents(0, 2)).toBe(0);
  });

  it('rejects a non-integer price, which is how float money gets in', () => {
    expect(() => lineTotalCents(9.99, 1)).toThrow(RangeError);
  });

  it('rejects zero and negative quantities', () => {
    expect(() => lineTotalCents(100, 0)).toThrow(RangeError);
    expect(() => lineTotalCents(100, -1)).toThrow(RangeError);
  });

  it('rejects a negative price', () => {
    expect(() => lineTotalCents(-100, 1)).toThrow(RangeError);
  });

  it('caps quantity at the documented maximum', () => {
    expect(lineTotalCents(100, MAX_LINE_QUANTITY)).toBe(100 * MAX_LINE_QUANTITY);
    expect(() => lineTotalCents(100, MAX_LINE_QUANTITY + 1)).toThrow(RangeError);
  });
});

describe('subtotalCents', () => {
  it('sums the lines', () => {
    expect(
      subtotalCents([
        { unitPriceCents: 14_900, quantity: 2 },
        { unitPriceCents: 2_900, quantity: 1 },
      ]),
    ).toBe(32_700);
  });

  it('treats an empty cart as zero', () => {
    expect(subtotalCents([])).toBe(0);
  });
});

describe('shippingCents', () => {
  it('charges the flat rate below the threshold', () => {
    expect(shippingCents(4_999, policy)).toBe(599);
  });

  it('is free exactly at the threshold, matching the advertised promise', () => {
    expect(shippingCents(5_000, policy)).toBe(0);
  });

  it('is free above the threshold', () => {
    expect(shippingCents(50_000, policy)).toBe(0);
  });

  it('is zero for an empty cart', () => {
    expect(shippingCents(0, policy)).toBe(0);
  });
});

describe('taxCents', () => {
  it('applies the basis-point rate', () => {
    // 10000 * 875 / 10000 = 875
    expect(taxCents(10_000, policy)).toBe(875);
  });

  it('rounds to the nearest cent', () => {
    // 999 * 875 / 10000 = 87.4125 -> 87
    expect(taxCents(999, policy)).toBe(87);
    // 1005 * 875 / 10000 = 87.9375 -> 88
    expect(taxCents(1_005, policy)).toBe(88);
  });

  it('rounds a half cent away from zero', () => {
    // 200 * 500 / 10000 = 10 exactly; use a rate that lands on .5
    // 1000 * 125 / 10000 = 12.5 -> 13
    expect(taxCents(1_000, { ...policy, taxBasisPoints: 125 })).toBe(13);
  });

  it('is zero at a zero subtotal', () => {
    expect(taxCents(0, policy)).toBe(0);
  });

  it('is zero under a zero rate', () => {
    expect(taxCents(10_000, { ...policy, taxBasisPoints: 0 })).toBe(0);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('rounds positive halves up', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
  });

  it('rounds negative halves down, unlike Math.round', () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0); // the asymmetry being corrected
  });
});

describe('priceCart', () => {
  it('computes the whole breakdown and totals add up', () => {
    const result = priceCart(
      [
        { unitPriceCents: 2_900, quantity: 1 },
        { unitPriceCents: 4_900, quantity: 2 },
      ],
      policy,
    );
    expect(result.subtotalCents).toBe(12_700);
    expect(result.shippingCents).toBe(0); // over the 5000 threshold
    expect(result.taxCents).toBe(1_111); // 12700 * 0.0875 = 1111.25 -> 1111
    expect(result.totalCents).toBe(13_811);
    expect(result.totalCents).toBe(
      result.subtotalCents + result.shippingCents + result.taxCents,
    );
  });

  it('adds shipping under the threshold and does not tax it', () => {
    const result = priceCart([{ unitPriceCents: 2_900, quantity: 1 }], policy);
    expect(result.subtotalCents).toBe(2_900);
    expect(result.shippingCents).toBe(599);
    // Tax is on 2900 only, not on 3499.
    expect(result.taxCents).toBe(254); // 2900 * 0.0875 = 253.75 -> 254
    expect(result.totalCents).toBe(3_753);
  });

  it('prices an empty cart as all zeros', () => {
    expect(priceCart([], policy)).toEqual({
      lines: [],
      subtotalCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('echoes each line total back', () => {
    const result = priceCart([{ unitPriceCents: 1_500, quantity: 3 }], policy);
    expect(result.lines).toEqual([
      { unitPriceCents: 1_500, quantity: 3, lineTotalCents: 4_500 },
    ]);
  });

  it('rejects a cart with too many lines', () => {
    const lines = Array.from({ length: MAX_CART_LINES + 1 }, () => ({
      unitPriceCents: 100,
      quantity: 1,
    }));
    expect(() => priceCart(lines, policy)).toThrow(RangeError);
  });

  it('stays exact where floating point would drift', () => {
    // 3 x $0.10 must be exactly 30 cents. In float dollars this is 0.30000000000000004.
    const result = priceCart([{ unitPriceCents: 10, quantity: 3 }], {
      taxBasisPoints: 0,
      freeShippingThresholdCents: 0,
      shippingFlatCents: 0,
    });
    expect(result.subtotalCents).toBe(30);
    expect(result.totalCents).toBe(30);
  });
});

describe('formatMoney', () => {
  it('renders cents as currency', () => {
    expect(formatMoney(14_900)).toBe('$149.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(0)).toBe('$0.00');
  });
});
