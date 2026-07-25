/**
 * Stock arithmetic, in one place, as pure functions.
 *
 * These predicates mirror the SQL guards used by the API's InventoryService and
 * the CHECK constraint in `migrations/*_stock_invariants`. Keeping them here
 * means the invariant can be unit-tested exhaustively in milliseconds, without
 * Postgres, and the integration test then proves the SQL agrees with the model.
 *
 * The one rule everything derives from:
 *
 *     0 <= stockReserved <= stockOnHand
 *     available = stockOnHand - stockReserved
 *
 * `stockOnHand` is physical inventory. `stockReserved` is the part of it already
 * promised to PENDING orders. Reserving raises `stockReserved` and leaves
 * `stockOnHand` alone, because the goods have not shipped. Fulfilling lowers
 * both by the same amount, because the goods left the building and the promise
 * is discharged in the same instant.
 */

export interface StockLevel {
  stockOnHand: number;
  stockReserved: number;
}

/** Stock a new order may still claim. Never negative under a valid level. */
export function availableStock(level: StockLevel): number {
  return level.stockOnHand - level.stockReserved;
}

/**
 * The invariant the database CHECK constraint enforces. Any state failing this
 * is a bug, not a business case.
 */
export function isValidStockLevel(level: StockLevel): boolean {
  return (
    Number.isInteger(level.stockOnHand) &&
    Number.isInteger(level.stockReserved) &&
    level.stockOnHand >= 0 &&
    level.stockReserved >= 0 &&
    level.stockReserved <= level.stockOnHand
  );
}

/**
 * Mirror of the reservation UPDATE's WHERE clause:
 *   WHERE id = $1 AND stock_on_hand - stock_reserved >= $qty
 */
export function canReserve(level: StockLevel, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) return false;
  return availableStock(level) >= quantity;
}

/** Reserve: hold stock for a PENDING order. On-hand is untouched. */
export function applyReserve(level: StockLevel, quantity: number): StockLevel {
  if (!canReserve(level, quantity)) {
    throw new RangeError(
      `cannot reserve ${quantity}: only ${availableStock(level)} available`,
    );
  }
  return { stockOnHand: level.stockOnHand, stockReserved: level.stockReserved + quantity };
}

/** Mirror of the release UPDATE's guard: never release more than is held. */
export function canRelease(level: StockLevel, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) return false;
  return level.stockReserved >= quantity;
}

/** Release: an order expired or was cancelled. The goods go back on the shelf. */
export function applyRelease(level: StockLevel, quantity: number): StockLevel {
  if (!canRelease(level, quantity)) {
    throw new RangeError(
      `cannot release ${quantity}: only ${level.stockReserved} reserved`,
    );
  }
  return { stockOnHand: level.stockOnHand, stockReserved: level.stockReserved - quantity };
}

/**
 * Fulfilment requires the reservation to still exist. Payment arriving after the
 * sweeper released the reservation is exactly the case this returns false for,
 * and the API turns that into a refund path rather than a silent oversell.
 */
export function canFulfill(level: StockLevel, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) return false;
  return level.stockReserved >= quantity && level.stockOnHand >= quantity;
}

/** Fulfil: goods ship. Both counters drop by the same amount. */
export function applyFulfill(level: StockLevel, quantity: number): StockLevel {
  if (!canFulfill(level, quantity)) {
    throw new RangeError(`cannot fulfill ${quantity} from ${JSON.stringify(level)}`);
  }
  return {
    stockOnHand: level.stockOnHand - quantity,
    stockReserved: level.stockReserved - quantity,
  };
}

/**
 * Admin restock. Positive delta only; a negative correction goes through
 * `applyAdjust`, which states plainly that it can fail.
 */
export function applyRestock(level: StockLevel, quantity: number): StockLevel {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('restock quantity must be a positive integer');
  }
  return { stockOnHand: level.stockOnHand + quantity, stockReserved: level.stockReserved };
}

/**
 * Admin adjustment: a signed correction to on-hand (shrinkage, recount).
 * It may not push on-hand below what is already promised to open orders, which
 * is the same thing the CHECK constraint would refuse.
 */
export function canAdjust(level: StockLevel, delta: number): boolean {
  if (!Number.isInteger(delta) || delta === 0) return false;
  const next = level.stockOnHand + delta;
  return next >= 0 && next >= level.stockReserved;
}

export function applyAdjust(level: StockLevel, delta: number): StockLevel {
  if (!canAdjust(level, delta)) {
    throw new RangeError(
      `cannot adjust by ${delta}: would violate 0 <= reserved <= on hand`,
    );
  }
  return { stockOnHand: level.stockOnHand + delta, stockReserved: level.stockReserved };
}

/**
 * A ledger movement's signed deltas. `SUM(onHandDelta)` over a variant's whole
 * ledger must reconstruct `stockOnHand` from zero; the concurrency integration
 * test asserts exactly that, which is how a lost update would be caught.
 */
export interface StockDeltas {
  onHandDelta: number;
  reservedDelta: number;
}

export type StockMovement = 'RESERVE' | 'RELEASE' | 'FULFILL' | 'RESTOCK' | 'ADJUST';

/**
 * The single mapping from movement to ledger deltas. Every writer uses it, so a
 * ledger row can never disagree with the counter update that accompanied it.
 * For ADJUST, `quantity` is the signed delta; for every other kind it is a
 * positive magnitude.
 */
export function movementDeltas(kind: StockMovement, quantity: number): StockDeltas {
  switch (kind) {
    case 'RESERVE':
      return { onHandDelta: 0, reservedDelta: quantity };
    case 'RELEASE':
      return { onHandDelta: 0, reservedDelta: -quantity };
    case 'FULFILL':
      return { onHandDelta: -quantity, reservedDelta: -quantity };
    case 'RESTOCK':
      return { onHandDelta: quantity, reservedDelta: 0 };
    case 'ADJUST':
      return { onHandDelta: quantity, reservedDelta: 0 };
  }
}

/**
 * Replay a ledger from zero. The result must equal the variant's stored counters
 * or the two have drifted, which means a write bypassed the ledger.
 */
export function replayLedger(
  movements: readonly { onHandDelta: number; reservedDelta: number }[],
): StockLevel {
  return movements.reduce<StockLevel>(
    (level, movement) => ({
      stockOnHand: level.stockOnHand + movement.onHandDelta,
      stockReserved: level.stockReserved + movement.reservedDelta,
    }),
    { stockOnHand: 0, stockReserved: 0 },
  );
}
