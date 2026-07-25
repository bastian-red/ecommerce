import { describe, expect, it } from 'vitest';
import {
  applyAdjust,
  applyFulfill,
  applyRelease,
  applyReserve,
  applyRestock,
  availableStock,
  canAdjust,
  canFulfill,
  canRelease,
  canReserve,
  isValidStockLevel,
  movementDeltas,
  replayLedger,
  type StockLevel,
} from './stock';

const level = (stockOnHand: number, stockReserved: number): StockLevel => ({
  stockOnHand,
  stockReserved,
});

describe('availableStock', () => {
  it('is on hand minus reserved', () => {
    expect(availableStock(level(10, 3))).toBe(7);
    expect(availableStock(level(3, 3))).toBe(0);
  });
});

describe('isValidStockLevel', () => {
  it('accepts the boundary states', () => {
    expect(isValidStockLevel(level(0, 0))).toBe(true);
    expect(isValidStockLevel(level(5, 5))).toBe(true);
  });

  it('rejects reserved above on hand, the oversell state', () => {
    expect(isValidStockLevel(level(3, 4))).toBe(false);
  });

  it('rejects negative counters', () => {
    expect(isValidStockLevel(level(-1, 0))).toBe(false);
    expect(isValidStockLevel(level(5, -1))).toBe(false);
  });

  it('rejects fractional counters', () => {
    expect(isValidStockLevel(level(1.5, 0))).toBe(false);
  });
});

describe('canReserve', () => {
  it('allows up to available and refuses one more', () => {
    expect(canReserve(level(10, 7), 3)).toBe(true);
    expect(canReserve(level(10, 7), 4)).toBe(false);
  });

  it('refuses when nothing is available', () => {
    expect(canReserve(level(5, 5), 1)).toBe(false);
  });

  it('refuses non-positive and fractional quantities', () => {
    expect(canReserve(level(10, 0), 0)).toBe(false);
    expect(canReserve(level(10, 0), -1)).toBe(false);
    expect(canReserve(level(10, 0), 1.5)).toBe(false);
  });
});

describe('applyReserve', () => {
  it('raises reserved and leaves on hand alone', () => {
    expect(applyReserve(level(10, 2), 3)).toEqual(level(10, 5));
  });

  it('throws rather than producing an invalid level', () => {
    expect(() => applyReserve(level(3, 3), 1)).toThrow(RangeError);
  });

  it('never produces a level the CHECK constraint would reject', () => {
    for (let onHand = 0; onHand <= 8; onHand++) {
      for (let reserved = 0; reserved <= onHand; reserved++) {
        for (let qty = 1; qty <= 8; qty++) {
          const start = level(onHand, reserved);
          if (!canReserve(start, qty)) continue;
          expect(isValidStockLevel(applyReserve(start, qty))).toBe(true);
        }
      }
    }
  });
});

describe('applyRelease', () => {
  it('lowers reserved only', () => {
    expect(applyRelease(level(10, 5), 2)).toEqual(level(10, 3));
  });

  it('refuses to release more than is held', () => {
    expect(canRelease(level(10, 1), 2)).toBe(false);
    expect(() => applyRelease(level(10, 1), 2)).toThrow(RangeError);
  });

  it('is the exact inverse of reserve', () => {
    const start = level(10, 4);
    expect(applyRelease(applyReserve(start, 3), 3)).toEqual(start);
  });
});

describe('applyFulfill', () => {
  it('lowers both counters by the same amount', () => {
    expect(applyFulfill(level(10, 4), 4)).toEqual(level(6, 0));
  });

  it('refuses to fulfil what was never reserved, so payment cannot oversell', () => {
    // The sweeper released this order's reservation before the webhook landed.
    expect(canFulfill(level(10, 0), 1)).toBe(false);
    expect(() => applyFulfill(level(10, 0), 1)).toThrow(RangeError);
  });

  it('drives the last unit to zero without going negative', () => {
    expect(applyFulfill(level(1, 1), 1)).toEqual(level(0, 0));
  });
});

describe('applyRestock', () => {
  it('raises on hand only', () => {
    expect(applyRestock(level(2, 1), 5)).toEqual(level(7, 1));
  });

  it('refuses a non-positive quantity', () => {
    expect(() => applyRestock(level(2, 1), 0)).toThrow(RangeError);
    expect(() => applyRestock(level(2, 1), -3)).toThrow(RangeError);
  });
});

describe('applyAdjust', () => {
  it('accepts a correction that stays above the reserved floor', () => {
    expect(applyAdjust(level(10, 4), -6)).toEqual(level(4, 4));
  });

  it('refuses a correction that would strand reserved stock', () => {
    expect(canAdjust(level(10, 4), -7)).toBe(false);
    expect(() => applyAdjust(level(10, 4), -7)).toThrow(RangeError);
  });

  it('refuses a zero delta as a no-op that would leave a meaningless ledger row', () => {
    expect(canAdjust(level(10, 0), 0)).toBe(false);
  });

  it('accepts a positive correction', () => {
    expect(applyAdjust(level(10, 4), 5)).toEqual(level(15, 4));
  });
});

describe('movementDeltas', () => {
  it('maps each movement to its signed deltas', () => {
    expect(movementDeltas('RESERVE', 3)).toEqual({ onHandDelta: 0, reservedDelta: 3 });
    expect(movementDeltas('RELEASE', 3)).toEqual({ onHandDelta: 0, reservedDelta: -3 });
    expect(movementDeltas('FULFILL', 3)).toEqual({ onHandDelta: -3, reservedDelta: -3 });
    expect(movementDeltas('RESTOCK', 3)).toEqual({ onHandDelta: 3, reservedDelta: 0 });
    expect(movementDeltas('ADJUST', -3)).toEqual({ onHandDelta: -3, reservedDelta: 0 });
  });

  it('agrees with the apply* functions for every movement', () => {
    const start = level(10, 4);
    const cases: Array<[Parameters<typeof movementDeltas>[0], number, StockLevel]> = [
      ['RESERVE', 2, applyReserve(start, 2)],
      ['RELEASE', 2, applyRelease(start, 2)],
      ['FULFILL', 2, applyFulfill(start, 2)],
      ['RESTOCK', 2, applyRestock(start, 2)],
      ['ADJUST', -2, applyAdjust(start, -2)],
    ];
    for (const [kind, qty, expected] of cases) {
      const deltas = movementDeltas(kind, qty);
      expect({
        stockOnHand: start.stockOnHand + deltas.onHandDelta,
        stockReserved: start.stockReserved + deltas.reservedDelta,
      }).toEqual(expected);
    }
  });
});

describe('replayLedger', () => {
  it('reconstructs the level from zero', () => {
    const movements = [
      movementDeltas('RESTOCK', 10),
      movementDeltas('RESERVE', 4),
      movementDeltas('FULFILL', 4),
      movementDeltas('RESERVE', 2),
    ];
    expect(replayLedger(movements)).toEqual(level(6, 2));
  });

  it('is zero for an empty ledger', () => {
    expect(replayLedger([])).toEqual(level(0, 0));
  });

  it('nets to zero when every reservation is released', () => {
    const movements = [
      movementDeltas('RESERVE', 3),
      movementDeltas('RELEASE', 3),
    ];
    expect(replayLedger(movements)).toEqual(level(0, 0));
  });
});
