import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

export interface ReleaseResult {
  released: boolean;
  reason: string;
}

export interface SweepResult {
  scanned: number;
  released: number;
}

/**
 * Releasing reservations that have outlived their TTL.
 *
 * ## Why there is no background worker
 *
 * There used to be one: a BullMQ consumer plus a 30-second interval in a
 * separate always-on process. It is gone, and not reluctantly.
 *
 * The delayed job was never the guarantee. A queued job can be lost to a Redis
 * flush, a queue rename, or a worker that was down when it fired; a query over
 * the orders table cannot miss a row that is sitting in it. So the sweep was
 * always the real mechanism and the job was decoration on top of it.
 *
 * What replaces it is strictly better. There are two triggers:
 *
 *  1. **Lazily, in the checkout path.** `CheckoutService` sweeps before it
 *     reserves. This is the one that matters: the only moment a stale
 *     reservation actually hurts is when it is standing between a real customer
 *     and stock they want, and that is exactly when this runs. A background
 *     sweep on a timer is, at best, up to one interval too late.
 *
 *  2. **`pg_cron`, in the database.** So orders still reach EXPIRED with zero
 *     traffic and the admin's numbers stay honest. See the
 *     `_reservation_sweep` migration; it runs the same guarded statements.
 *
 * Neither needs a process to be running, which is what makes the whole
 * application deployable to a serverless host for nothing.
 *
 * ## Why the guards are all in SQL
 *
 * `WHERE status = 'PENDING' AND reservation_expires_at <= NOW()` means this
 * cannot cancel an order that was paid a millisecond ago, and cannot release one
 * whose deadline has not passed. Reading the order first and deciding in
 * TypeScript would leave a window in which the payment webhook commits, and the
 * result would be a cancelled order the customer has already paid for.
 *
 * Idempotent by construction: a second run updates zero rows and releases
 * nothing, so overlapping sweeps are harmless. That matters more here than it
 * did with a single worker, because the lazy path means many requests can be
 * sweeping at once.
 */
@Injectable()
export class ReservationSweepService {
  private readonly logger = new Logger(ReservationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /** Expire one past-due order and put its stock back. */
  async releaseExpiredOrder(orderId: string): Promise<ReleaseResult> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$executeRaw`
        UPDATE "orders"
           SET "status" = 'EXPIRED'::"OrderStatus",
               "closed_at" = NOW(),
               "updated_at" = NOW()
         WHERE "id" = ${orderId}
           AND "status" = 'PENDING'::"OrderStatus"
           AND "reservation_expires_at" IS NOT NULL
           AND "reservation_expires_at" <= NOW()`;

      if (expired === 0) {
        return { released: false, reason: 'not a past-due PENDING order' };
      }

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { variantId: true, quantity: true },
      });

      // Reuses the same guarded UPDATE and ledger writer the rest of the
      // application uses, including its deterministic lock ordering, so an
      // expiry cannot disagree with a checkout about how stock moves.
      await this.inventory.release(tx, orderId, items, 'reservation-expired');

      return { released: true, reason: `released ${items.length} line(s)` };
    });
  }

  /**
   * Find past-due PENDING orders and release them.
   *
   * `limit` is deliberately small when called from the request path: this runs
   * inside a customer's checkout, so it must stay bounded and cheap. The partial
   * index `orders_pending_expiry_idx` makes the lookup an index scan rather than
   * a walk of the order table.
   */
  async sweep(limit = 20): Promise<SweepResult> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING', reservationExpiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { reservationExpiresAt: 'asc' },
      take: limit,
    });

    let released = 0;
    for (const order of due) {
      const result = await this.releaseExpiredOrder(order.id);
      if (result.released) released += 1;
    }
    return { scanned: due.length, released };
  }

  /**
   * The checkout path's entry point. Never throws.
   *
   * A failure to reclaim expired stock must not fail a checkout that might well
   * succeed without it: the worst case is that the customer sees the stock as
   * unavailable, which is the same answer they would have got a second earlier.
   * The `pg_cron` backstop will pick it up regardless.
   */
  async sweepQuietly(limit = 20): Promise<SweepResult> {
    try {
      return await this.sweep(limit);
    } catch (error) {
      this.logger.error(
        `Reservation sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { scanned: 0, released: 0 };
    }
  }
}
