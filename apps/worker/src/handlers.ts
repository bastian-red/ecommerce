import type { PrismaClient } from '@shop/db';
import type { NotificationService, OrderEmailData } from '@shop/notifications';
import type { OrderEmailJob } from '@shop/shared';

export interface WorkerDeps {
  prisma: PrismaClient;
  notifications: NotificationService;
  appBaseUrl: string;
}

export interface ReleaseResult {
  released: boolean;
  reason: string;
}

/**
 * Release an expired reservation.
 *
 * Every guard here is in the SQL, not in TypeScript. `WHERE status = 'PENDING'
 * AND reservation_expires_at <= NOW()` means the worker cannot cancel an order
 * that was paid a millisecond ago, and cannot release one whose deadline has not
 * passed. Reading the order first and deciding in application code would leave a
 * window between the read and the write in which the payment webhook commits,
 * and the result would be a cancelled order the customer has already paid for.
 *
 * Idempotent by construction: a second run updates zero rows and releases
 * nothing, so a retried job or an overlapping sweep is harmless.
 */
export async function releaseExpiredOrder(
  deps: WorkerDeps,
  orderId: string,
): Promise<ReleaseResult> {
  return deps.prisma.$transaction(async (tx) => {
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
      // Same deterministic lock order the API uses, for the same reason.
      orderBy: { variantId: 'asc' },
    });

    for (const item of items) {
      const updated = await tx.$executeRaw`
        UPDATE "product_variants"
           SET "stock_reserved" = "stock_reserved" - ${item.quantity},
               "updated_at" = NOW()
         WHERE "id" = ${item.variantId}
           AND "stock_reserved" >= ${item.quantity}`;
      if (updated === 1) {
        await tx.stockLedger.create({
          data: {
            variantId: item.variantId,
            orderId,
            kind: 'RELEASE',
            onHandDelta: 0,
            reservedDelta: -item.quantity,
            reason: 'reservation-expired',
          },
        });
      }
    }

    return { released: true, reason: `released ${items.length} line(s)` };
  });
}

/**
 * Find every past-due PENDING order and release it.
 *
 * This sweep, not the delayed BullMQ job, is the actual guarantee that stock is
 * never stranded. A delayed job can be lost to a Redis flush, a queue rename, or
 * a worker that was down when it fired; a query over the orders table cannot
 * miss a row that is sitting there. The delayed job is the fast path, this is the
 * safety net, and both funnel into the same idempotent release.
 *
 * The partial index `orders_pending_expiry_idx` makes this a cheap index scan
 * rather than a sequential scan of the order table.
 */
export async function sweepExpiredReservations(
  deps: WorkerDeps,
  limit = 100,
): Promise<{ scanned: number; released: number }> {
  const due = await deps.prisma.order.findMany({
    where: { status: 'PENDING', reservationExpiresAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { reservationExpiresAt: 'asc' },
    take: limit,
  });

  let released = 0;
  for (const order of due) {
    const result = await releaseExpiredOrder(deps, order.id);
    if (result.released) released += 1;
  }
  return { scanned: due.length, released };
}

/** Send an order email. Missing orders are skipped, not retried forever. */
export async function sendOrderEmail(
  deps: WorkerDeps,
  job: OrderEmailJob,
): Promise<{ sent: boolean; reason?: string }> {
  const order = await deps.prisma.order.findUnique({
    where: { id: job.orderId },
    include: { items: true, user: { select: { name: true } } },
  });
  if (!order) return { sent: false, reason: 'order not found' };

  const data: OrderEmailData = {
    orderNumber: order.number,
    email: order.email,
    customerName: order.user?.name ?? order.shippingName,
    currency: order.currency,
    items: order.items.map((item) => ({
      productTitle: item.productTitle,
      variantName: item.variantName,
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
    })),
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    orderUrl: `${deps.appBaseUrl}/orders/${order.id}`,
  };

  await deps.notifications.send(job.kind, data);
  return { sent: true };
}
