import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@shop/db';
import type { ParsedWebhook } from '@shop/payments';
import { isTerminalOrderStatus } from '@shop/shared';
import { InventoryService } from '../inventory/inventory.service';
import { OrderEmailService } from '../notifications/order-email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the controller should answer with. `retryable` is the important one: it
 * is the difference between telling the provider "we handled it" and "come
 * back", and getting it wrong either loses a payment or produces an infinite
 * retry loop.
 */
export interface WebhookOutcome {
  handled: boolean;
  duplicate: boolean;
  retryable: boolean;
  detail: string;
  /**
   * An order whose confirmation email should go out once the transaction has
   * committed. It is carried out of the transaction rather than sent inside it,
   * because SMTP is a network call and holding row locks across one would stall
   * every other checkout on those variants.
   */
  sendConfirmationFor?: string;
}

/**
 * Idempotent webhook processing. This is the thing this project exists to
 * demonstrate, so the reasoning is written down rather than implied.
 *
 * ## Layer 1 — the dedupe table's primary key
 *
 * Ingest is `INSERT ... ON CONFLICT DO NOTHING` into `webhook_events`, whose
 * primary key is `(provider, event_id)`. A duplicate delivery inserts zero rows
 * and is acknowledged without processing.
 *
 * The tempting alternative is `if (await findEvent(id)) return;`. That races:
 * two concurrent deliveries of the same event both find nothing, both proceed,
 * and stock is decremented twice. A primary key cannot race, because uniqueness
 * is enforced by the index at write time, not by application code at read time.
 * When two transactions insert the same key concurrently, the second blocks on
 * the first's row lock and then, on commit, sees the conflict and reports zero
 * rows. That is exactly the serialisation needed, obtained for free.
 *
 * ## Layer 2 — the guarded transition
 *
 * Marking an order paid is
 * `UPDATE orders SET status='PAID' WHERE id=$1 AND status='PENDING'`, in the
 * same transaction as the stock fulfilment and the ledger rows. Zero rows
 * updated means someone else already did it. A replay that somehow slips past
 * layer 1 therefore still cannot decrement stock twice, because the decrement
 * only runs when this UPDATE claimed the transition.
 *
 * ## Layer 3 — out-of-order and late delivery
 *
 * Providers do not guarantee order. An event for an order that does not exist
 * yet is answered 5xx so the provider retries; answering 200 would drop a real
 * payment on the floor. An event for an order already in a terminal state is
 * acknowledged and ignored, because there is nothing left to do and a retry loop
 * helps no one.
 *
 * ## Everything is one transaction
 *
 * The dedupe insert lives in the same transaction as the processing. If
 * processing throws, the insert rolls back with it, so the provider's retry
 * finds no dedupe row and reprocesses. An insert committed separately would mark
 * a failed event as handled forever.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly email: OrderEmailService,
  ) {}

  async handle(provider: string, event: ParsedWebhook): Promise<WebhookOutcome> {
    // Annotated rather than inferred: the two return sites produce narrower
    // object literals, and their union would drop the optional
    // `sendConfirmationFor` that the post-commit dispatch below reads.
    const outcome: WebhookOutcome = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "webhook_events" ("provider", "event_id", "type", "payload", "order_id", "received_at")
        VALUES (${provider}, ${event.eventId}, ${event.type},
                ${JSON.stringify(event)}::jsonb, ${event.orderId ?? null}, NOW())
        ON CONFLICT ("provider", "event_id") DO NOTHING`;

      if (inserted === 0) {
        return {
          handled: true,
          duplicate: true,
          retryable: false,
          detail: 'Duplicate delivery ignored',
        } satisfies WebhookOutcome;
      }

      const result = await this.process(tx, event);

      if (result.retryable) {
        // Roll the dedupe row back so the provider's retry is reprocessed rather
        // than silently swallowed as a duplicate.
        throw new RetryableWebhookError(result.detail);
      }

      await tx.webhookEvent.update({
        where: { provider_eventId: { provider, eventId: event.eventId } },
        data: { processedAt: new Date() },
      });

      return result;
    }).catch((error: unknown) => {
      if (error instanceof RetryableWebhookError) {
        return {
          handled: false,
          duplicate: false,
          retryable: true,
          detail: error.message,
        } satisfies WebhookOutcome;
      }
      throw error;
    });

    if (outcome.handled && !outcome.duplicate) {
      this.logger.log(`Processed ${provider} ${event.type} ${event.eventId}: ${outcome.detail}`);
    }

    // After the commit, never before, and awaited so a serverless invocation is
    // not frozen mid-send. `send` swallows its own failures: the money and the
    // stock have already moved, and an unreachable mail server must not turn a
    // completed order into a retryable webhook.
    if (outcome.sendConfirmationFor) {
      await this.email.send({ orderId: outcome.sendConfirmationFor, kind: 'ORDER_CONFIRMED' });
    }

    return outcome;
  }

  private async process(
    tx: Prisma.TransactionClient,
    event: ParsedWebhook,
  ): Promise<WebhookOutcome> {
    if (event.isPaymentComplete) return this.completePayment(tx, event);
    if (event.isPaymentFailed) return this.failPayment(tx, event);
    if (event.isSessionExpired) return this.expireSession(tx, event);

    // Everything else (payment_intent.succeeded, unrelated event types) is
    // recorded and acknowledged. Answering anything but 200 to an event we do
    // not act on would put the provider into a retry loop over nothing.
    return { handled: true, duplicate: false, retryable: false, detail: 'No action for this type' };
  }

  private async completePayment(
    tx: Prisma.TransactionClient,
    event: ParsedWebhook,
  ): Promise<WebhookOutcome> {
    const order = await this.resolveOrder(tx, event);
    if (!order) {
      return {
        handled: false,
        duplicate: false,
        retryable: true,
        detail: `No order for event ${event.eventId}; asking the provider to retry`,
      };
    }

    if (isTerminalOrderStatus(order.status)) {
      return {
        handled: true,
        duplicate: false,
        retryable: false,
        detail: `Order ${order.number} is ${order.status}; late event ignored`,
      };
    }

    // Layer 2. This UPDATE is the claim on the transition; everything after it
    // runs exactly once because only one transaction can see rowcount 1.
    const claimed = await tx.$executeRaw`
      UPDATE "orders"
         SET "status" = 'PAID'::"OrderStatus",
             "paid_at" = NOW(),
             "reservation_expires_at" = NULL,
             "updated_at" = NOW()
       WHERE "id" = ${order.id}
         AND "status" = 'PENDING'::"OrderStatus"`;

    if (claimed === 0) {
      return {
        handled: true,
        duplicate: false,
        retryable: false,
        detail: `Order ${order.number} was already transitioned; nothing to do`,
      };
    }

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: { variantId: true, quantity: true },
    });

    const fulfilment = await this.inventory.fulfill(tx, order.id, items);
    if (!fulfilment.ok) {
      // The reservation was already released, almost certainly by the sweeper
      // between expiry and this payment landing. The money is real, so the order
      // stays PAID and is flagged for the admin rather than silently overselling
      // by forcing the stock down.
      this.logger.error(
        `Order ${order.number} paid but ${fulfilment.unfulfilled.length} line(s) had no ` +
          `reservation left (variants: ${fulfilment.unfulfilled.join(', ')}). Needs manual review.`,
      );
    }

    // The partial unique index payments_one_succeeded_per_order is the backstop:
    // even if this ran twice, a second SUCCEEDED row for the order cannot commit.
    await tx.payment.updateMany({
      where: { orderId: order.id, ...(event.sessionId ? { sessionId: event.sessionId } : {}) },
      data: {
        status: 'SUCCEEDED',
        paymentIntentId: event.paymentIntentId ?? null,
        updatedAt: new Date(),
      },
    });

    return {
      handled: true,
      duplicate: false,
      retryable: false,
      // Dispatched by `handle` after this transaction commits.
      sendConfirmationFor: order.id,
      detail: fulfilment.ok
        ? `Order ${order.number} paid and stock fulfilled`
        : `Order ${order.number} paid; stock needs manual review`,
    };
  }

  private async failPayment(
    tx: Prisma.TransactionClient,
    event: ParsedWebhook,
  ): Promise<WebhookOutcome> {
    const order = await this.resolveOrder(tx, event);
    if (!order) {
      // A failed payment for an unknown order is not worth retrying forever:
      // there is no state to correct. Acknowledge and move on.
      return {
        handled: true,
        duplicate: false,
        retryable: false,
        detail: 'Failure event for an unknown order; ignored',
      };
    }

    await tx.payment.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'FAILED', paymentIntentId: event.paymentIntentId ?? null },
    });

    // The order is deliberately left PENDING. A failed card is a retryable
    // situation for the customer, and cancelling it here would drop the
    // reservation they may be about to pay for. The TTL handles the rest.
    return {
      handled: true,
      duplicate: false,
      retryable: false,
      detail: `Payment failed for ${order.number}; reservation left to expire`,
    };
  }

  private async expireSession(
    tx: Prisma.TransactionClient,
    event: ParsedWebhook,
  ): Promise<WebhookOutcome> {
    const order = await this.resolveOrder(tx, event);
    if (!order) {
      return {
        handled: true,
        duplicate: false,
        retryable: false,
        detail: 'Expiry event for an unknown order; ignored',
      };
    }

    const expired = await tx.$executeRaw`
      UPDATE "orders"
         SET "status" = 'EXPIRED'::"OrderStatus",
             "closed_at" = NOW(),
             "updated_at" = NOW()
       WHERE "id" = ${order.id}
         AND "status" = 'PENDING'::"OrderStatus"`;

    if (expired === 0) {
      return {
        handled: true,
        duplicate: false,
        retryable: false,
        detail: `Order ${order.number} is ${order.status}; expiry ignored`,
      };
    }

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: { variantId: true, quantity: true },
    });
    await this.inventory.release(tx, order.id, items, 'gateway-session-expired');

    return {
      handled: true,
      duplicate: false,
      retryable: false,
      detail: `Order ${order.number} expired and stock released`,
    };
  }

  /**
   * Find the order from the event. Metadata is the primary route; the session id
   * is the fallback for a provider event that lost the metadata, which is why
   * the Payment row carries the session id at all.
   */
  private async resolveOrder(
    tx: Prisma.TransactionClient,
    event: ParsedWebhook,
  ): Promise<{ id: string; number: string; status: 'PENDING' | 'PAID' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED' } | null> {
    if (event.orderId) {
      const order = await tx.order.findUnique({
        where: { id: event.orderId },
        select: { id: true, number: true, status: true },
      });
      if (order) return order;
    }
    if (event.sessionId) {
      const payment = await tx.payment.findUnique({
        where: { sessionId: event.sessionId },
        select: { order: { select: { id: true, number: true, status: true } } },
      });
      if (payment?.order) return payment.order;
    }
    return null;
  }
}

/** Internal signal: roll the transaction back and answer with a retryable status. */
class RetryableWebhookError extends Error {}
