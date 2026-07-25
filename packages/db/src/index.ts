import { PrismaClient } from '../generated/client';

export * from '../generated/client';
export { PrismaClient };

/** Postgres SQLSTATEs we branch on. */
export const PG_CHECK_VIOLATION = '23514';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Names of the invariants declared in the _stock_invariants migration. Code that
 * catches a constraint violation matches on these rather than on a message.
 */
export const VARIANT_STOCK_CONSTRAINT = 'variant_stock_non_negative';
export const ONE_SUCCEEDED_PAYMENT_INDEX = 'payments_one_succeeded_per_order';

interface PgError {
  code?: string;
  meta?: { constraint?: unknown; target?: unknown };
}

function pgError(err: unknown): PgError | null {
  return typeof err === 'object' && err !== null ? (err as PgError) : null;
}

function constraintName(err: PgError): string {
  const c = err.meta?.constraint;
  if (typeof c === 'string') return c;
  const t = err.meta?.target;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.join(',');
  return '';
}

/**
 * True when the error is the stock CHECK constraint firing — i.e. something tried
 * to drive a variant's stock negative or reserve more than exists. This is the
 * last line of defence; the conditional UPDATEs in InventoryService are supposed
 * to make it unreachable, so seeing it means there is a bug to fix, not a case to
 * swallow.
 */
export function isStockInvariantViolation(err: unknown): boolean {
  const e = pgError(err);
  if (!e || e.code !== PG_CHECK_VIOLATION) return false;
  const name = constraintName(e);
  return name === '' || name.includes(VARIANT_STOCK_CONSTRAINT);
}

/**
 * True when a second SUCCEEDED payment was attempted for an order that already
 * has one. Callers treat this as "already paid" and acknowledge the webhook.
 */
export function isDuplicateSucceededPayment(err: unknown): boolean {
  const e = pgError(err);
  if (!e || e.code !== PG_UNIQUE_VIOLATION) return false;
  return constraintName(e).includes(ONE_SUCCEEDED_PAYMENT_INDEX);
}

export function isUniqueViolation(err: unknown): boolean {
  return pgError(err)?.code === PG_UNIQUE_VIOLATION;
}

let client: PrismaClient | undefined;

/**
 * Memoized singleton. Next.js hot-reload and repeated worker imports would
 * otherwise open a new pool per module instance and exhaust Postgres.
 */
export function getPrisma(): PrismaClient {
  if (!client) client = new PrismaClient();
  return client;
}
