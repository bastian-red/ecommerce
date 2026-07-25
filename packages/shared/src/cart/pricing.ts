/**
 * Order pricing. Pure, total, and integer-only.
 *
 * Every amount in this file is minor units (cents). Floats never touch money:
 * `0.1 + 0.2 !== 0.3` is a rounding bug in a ledger, and a store that computes
 * a total the customer's card is then charged for cannot afford one.
 *
 * The order of operations is fixed and the API's checkout, the storefront's cart
 * summary, and the order snapshot all call the same function, so a total can
 * never differ between what the customer sees and what the gateway charges.
 *
 *   line total = unit price x quantity
 *   subtotal   = sum of line totals
 *   shipping   = 0 if subtotal >= free threshold, else flat rate
 *   tax        = round(subtotal x basis points / 10000)   [subtotal only]
 *   total      = subtotal + shipping + tax
 *
 * Tax is charged on the subtotal and not on shipping. That is a policy choice,
 * not a law: a real store would delegate to a tax engine per jurisdiction. It is
 * stated here so the number is explainable rather than accidental.
 */

/** Upper bound on a single line's quantity. Guards both UI and API input. */
export const MAX_LINE_QUANTITY = 99;

/** Upper bound on distinct lines in one cart. Bounds the checkout transaction. */
export const MAX_CART_LINES = 50;

export interface PricingPolicy {
  /** Tax rate in basis points. 875 = 8.75%. */
  taxBasisPoints: number;
  /** Subtotal at or above which shipping is free, in cents. */
  freeShippingThresholdCents: number;
  /** Flat shipping charge below the threshold, in cents. */
  shippingFlatCents: number;
}

export interface PricedLineInput {
  unitPriceCents: number;
  quantity: number;
}

export interface PricedLine extends PricedLineInput {
  lineTotalCents: number;
}

export interface PriceBreakdown {
  lines: PricedLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${value}`);
  }
}

/**
 * Round half away from zero, which is what a customer expects from a price and
 * what every invoice in the tests asserts.
 *
 * `Math.round` rounds half *up* (toward +Infinity), so `Math.round(-0.5)` is
 * `-0`, not `-1`. Money in this codebase is never negative, but the asymmetry
 * would be a silent one-cent bug the day refunds are added, so it is handled
 * here rather than assumed away.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** unit price x quantity, validated. */
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  assertInteger('unitPriceCents', unitPriceCents);
  assertInteger('quantity', quantity);
  if (unitPriceCents < 0) throw new RangeError('unitPriceCents must be >= 0');
  if (quantity < 1) throw new RangeError('quantity must be >= 1');
  if (quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(`quantity must be <= ${MAX_LINE_QUANTITY}`);
  }
  return unitPriceCents * quantity;
}

/** Sum of line totals. An empty cart is a zero subtotal, not an error. */
export function subtotalCents(lines: readonly PricedLineInput[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line.unitPriceCents, line.quantity), 0);
}

/**
 * Free at or above the threshold. Note `>=`: a cart landing exactly on the
 * advertised "free shipping over $50" number ships free, because that is what
 * the banner promises.
 */
export function shippingCents(subtotal: number, policy: PricingPolicy): number {
  assertInteger('subtotal', subtotal);
  if (subtotal <= 0) return 0;
  return subtotal >= policy.freeShippingThresholdCents ? 0 : policy.shippingFlatCents;
}

/** Tax on the subtotal only, rounded to the nearest cent. */
export function taxCents(subtotal: number, policy: PricingPolicy): number {
  assertInteger('subtotal', subtotal);
  if (subtotal <= 0) return 0;
  return roundHalfAwayFromZero((subtotal * policy.taxBasisPoints) / 10_000);
}

/** The whole breakdown in one pass. This is the only function checkout calls. */
export function priceCart(
  lines: readonly PricedLineInput[],
  policy: PricingPolicy,
): PriceBreakdown {
  if (lines.length > MAX_CART_LINES) {
    throw new RangeError(`cart must have at most ${MAX_CART_LINES} lines`);
  }
  const priced = lines.map((line) => ({
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    lineTotalCents: lineTotalCents(line.unitPriceCents, line.quantity),
  }));
  const subtotal = priced.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const shipping = shippingCents(subtotal, policy);
  const tax = taxCents(subtotal, policy);
  return {
    lines: priced,
    subtotalCents: subtotal,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: subtotal + shipping + tax,
  };
}

/**
 * Display helper. Kept next to the maths so the storefront never re-implements
 * cents-to-string and drifts by a factor of 100.
 */
export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
