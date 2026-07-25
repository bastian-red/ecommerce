import { describe, expect, it } from 'vitest';
import { InventoryService } from './inventory.service';

/**
 * The SQL paths are covered by the integration suite against a real Postgres.
 * What is unit-testable here is the deterministic lock ordering, which is the
 * property that makes multi-line orders deadlock-free.
 */
describe('InventoryService.orderLines', () => {
  it('sorts lines by variant id', () => {
    const ordered = InventoryService.orderLines([
      { variantId: 'v3', quantity: 1 },
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', quantity: 3 },
    ]);
    expect(ordered.map((line) => line.variantId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('gives two orders holding the same variants the same lock order', () => {
    // This is the whole point: A locks v1 then v2, B locks v1 then v2. Without
    // it, A holds v1 waiting for v2 while B holds v2 waiting for v1.
    const orderA = InventoryService.orderLines([
      { variantId: 'clx_b', quantity: 1 },
      { variantId: 'clx_a', quantity: 1 },
    ]);
    const orderB = InventoryService.orderLines([
      { variantId: 'clx_a', quantity: 2 },
      { variantId: 'clx_b', quantity: 2 },
    ]);
    expect(orderA.map((line) => line.variantId)).toEqual(orderB.map((line) => line.variantId));
  });

  it('does not mutate the caller\'s array', () => {
    const input = [
      { variantId: 'v2', quantity: 1 },
      { variantId: 'v1', quantity: 1 },
    ];
    InventoryService.orderLines(input);
    expect(input.map((line) => line.variantId)).toEqual(['v2', 'v1']);
  });

  it('preserves quantities alongside the ids', () => {
    const ordered = InventoryService.orderLines([
      { variantId: 'v2', quantity: 7 },
      { variantId: 'v1', quantity: 5 },
    ]);
    expect(ordered).toEqual([
      { variantId: 'v1', quantity: 5 },
      { variantId: 'v2', quantity: 7 },
    ]);
  });

  it('handles empty and single-line inputs', () => {
    expect(InventoryService.orderLines([])).toEqual([]);
    expect(InventoryService.orderLines([{ variantId: 'v1', quantity: 1 }])).toEqual([
      { variantId: 'v1', quantity: 1 },
    ]);
  });

  it('is idempotent: sorting a sorted list changes nothing', () => {
    const once = InventoryService.orderLines([
      { variantId: 'v3', quantity: 1 },
      { variantId: 'v1', quantity: 1 },
    ]);
    expect(InventoryService.orderLines(once)).toEqual(once);
  });
});
