import { Injectable, Logger } from '@nestjs/common';
import { Prisma, isStockInvariantViolation } from '@shop/db';
import { movementDeltas, type StockMovement } from '@shop/shared';
import type { PrismaTx } from '../prisma/prisma.service';

export interface StockLine {
  variantId: string;
  quantity: number;
}

export interface ReservationFailure {
  variantId: string;
  requested: number;
  available: number;
}

/**
 * Every stock mutation in the application goes through this service, and every
 * one of them is a single conditional UPDATE.
 *
 * ## Why not read-modify-write
 *
 * The obvious implementation is `SELECT stock; if (stock >= qty) UPDATE stock`.
 * That is a lost update waiting to happen: two transactions both read 3, both
 * decide 3 >= 3, and both write. READ COMMITTED will happily let that commit.
 * The version here never reads first. Availability is the UPDATE's own WHERE
 * clause:
 *
 *     UPDATE product_variants
 *        SET stock_reserved = stock_reserved + $qty
 *      WHERE id = $id AND stock_on_hand - stock_reserved >= $qty
 *
 * Postgres takes a row lock for the duration of the statement, re-evaluates the
 * predicate against the committed row, and reports how many rows it changed.
 * Zero means the stock was gone. There is no window between the check and the
 * write because they are the same statement.
 *
 * ## Why the CHECK constraint still exists
 *
 * Because this class could have a bug. `variant_stock_non_negative` is the layer
 * that does not depend on application code being right: even a hand-written
 * UPDATE in psql cannot commit an overselling row. If it ever fires, that is a
 * defect to fix, not a case to catch and continue from.
 *
 * ## Why lines are sorted
 *
 * Two orders containing the same two variants in opposite order would each hold
 * one row lock and wait for the other. Sorting variant ids gives every
 * transaction the same lock order, so that deadlock cannot form.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /** Deterministic lock order. Every multi-line mutation goes through this. */
  static orderLines(lines: readonly StockLine[]): StockLine[] {
    return [...lines].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  }

  /**
   * Reserve stock for a PENDING order. Returns the lines that could not be
   * satisfied; an empty array means every line was reserved.
   *
   * The caller must be inside a transaction: a partial reservation has to roll
   * back completely, or an order holds stock for items it never bought.
   */
  async reserve(
    tx: PrismaTx,
    orderId: string,
    lines: readonly StockLine[],
  ): Promise<ReservationFailure[]> {
    const failures: ReservationFailure[] = [];

    for (const line of InventoryService.orderLines(lines)) {
      const updated = await tx.$executeRaw`
        UPDATE "product_variants"
           SET "stock_reserved" = "stock_reserved" + ${line.quantity},
               "updated_at" = NOW()
         WHERE "id" = ${line.variantId}
           AND "stock_on_hand" - "stock_reserved" >= ${line.quantity}`;

      if (updated === 0) {
        // Read the current level only to build a useful error message. This read
        // is advisory: by the time the customer sees it the number may have moved
        // again, which is fine, because the authoritative answer was the UPDATE
        // that just refused.
        const variant = await tx.productVariant.findUnique({
          where: { id: line.variantId },
          select: { stockOnHand: true, stockReserved: true },
        });
        failures.push({
          variantId: line.variantId,
          requested: line.quantity,
          available: variant ? variant.stockOnHand - variant.stockReserved : 0,
        });
        continue;
      }

      await this.writeLedger(tx, line.variantId, orderId, 'RESERVE', line.quantity, 'checkout');
    }

    return failures;
  }

  /**
   * Release a reservation (order expired or was cancelled). Guarded so it can
   * never drive `stock_reserved` negative, which makes it safe to call twice:
   * the second call updates zero rows and writes no ledger entry.
   */
  async release(
    tx: PrismaTx,
    orderId: string,
    lines: readonly StockLine[],
    reason: string,
  ): Promise<number> {
    let released = 0;
    for (const line of InventoryService.orderLines(lines)) {
      const updated = await tx.$executeRaw`
        UPDATE "product_variants"
           SET "stock_reserved" = "stock_reserved" - ${line.quantity},
               "updated_at" = NOW()
         WHERE "id" = ${line.variantId}
           AND "stock_reserved" >= ${line.quantity}`;
      if (updated === 1) {
        await this.writeLedger(tx, line.variantId, orderId, 'RELEASE', line.quantity, reason);
        released += 1;
      }
    }
    return released;
  }

  /**
   * Fulfil a paid order: the goods leave the building, so on-hand and reserved
   * both drop by the same amount.
   *
   * Returns false when a line could not be fulfilled, which happens when the
   * sweeper released the reservation before the payment webhook arrived. The
   * caller must treat that as a refund case, never as a silent oversell, which
   * is why this reports rather than forcing the write through.
   */
  async fulfill(
    tx: PrismaTx,
    orderId: string,
    lines: readonly StockLine[],
  ): Promise<{ ok: boolean; unfulfilled: string[] }> {
    const unfulfilled: string[] = [];
    for (const line of InventoryService.orderLines(lines)) {
      const updated = await tx.$executeRaw`
        UPDATE "product_variants"
           SET "stock_on_hand" = "stock_on_hand" - ${line.quantity},
               "stock_reserved" = "stock_reserved" - ${line.quantity},
               "updated_at" = NOW()
         WHERE "id" = ${line.variantId}
           AND "stock_reserved" >= ${line.quantity}
           AND "stock_on_hand" >= ${line.quantity}`;
      if (updated === 1) {
        await this.writeLedger(tx, line.variantId, orderId, 'FULFILL', line.quantity, 'payment');
      } else {
        unfulfilled.push(line.variantId);
      }
    }
    return { ok: unfulfilled.length === 0, unfulfilled };
  }

  /**
   * Admin restock or correction. `delta` is positive for RESTOCK and signed for
   * ADJUST. The guard mirrors the CHECK constraint so an over-aggressive
   * correction returns a clean failure instead of a 500 from the database.
   */
  async adjust(
    tx: PrismaTx,
    variantId: string,
    kind: 'RESTOCK' | 'ADJUST',
    delta: number,
    reason: string,
    actorId: string,
  ): Promise<boolean> {
    if (delta === 0) return false;
    if (kind === 'RESTOCK' && delta < 0) return false;

    const updated = await tx.$executeRaw`
      UPDATE "product_variants"
         SET "stock_on_hand" = "stock_on_hand" + ${delta},
             "updated_at" = NOW()
       WHERE "id" = ${variantId}
         AND "stock_on_hand" + ${delta} >= 0
         AND "stock_on_hand" + ${delta} >= "stock_reserved"`;

    if (updated !== 1) return false;
    await this.writeLedger(tx, variantId, null, kind, delta, reason, actorId);
    return true;
  }

  /**
   * One writer for ledger rows, so a movement's deltas can never disagree with
   * the counter update that accompanied it. `movementDeltas` is the same pure
   * function the gate tests assert against.
   */
  private async writeLedger(
    tx: PrismaTx,
    variantId: string,
    orderId: string | null,
    kind: StockMovement,
    quantity: number,
    reason: string,
    actorId?: string,
  ): Promise<void> {
    const deltas = movementDeltas(kind, quantity);
    await tx.stockLedger.create({
      data: {
        variantId,
        orderId,
        kind,
        onHandDelta: deltas.onHandDelta,
        reservedDelta: deltas.reservedDelta,
        reason,
        actorId: actorId ?? null,
      },
    });
  }

  /**
   * Translate a database-level invariant violation into a log line and a signal
   * to the caller. Reaching this means a write bypassed the guards above, which
   * is a bug in this file, not a business condition.
   */
  isOversellAttempt(error: unknown): boolean {
    if (isStockInvariantViolation(error)) {
      this.logger.error(
        'variant_stock_non_negative fired: a stock write bypassed InventoryService guards',
      );
      return true;
    }
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010';
  }
}
