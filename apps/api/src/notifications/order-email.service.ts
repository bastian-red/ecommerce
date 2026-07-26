import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NotificationService,
  createChannelFromEnv,
  type OrderEmailData,
} from '@shop/notifications';
import type { OrderEmailJob } from '@shop/shared';
import { CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Order emails, sent from the API instead of from a queue.
 *
 * ## Why there is no queue any more
 *
 * A job queue buys two things: retries, and getting slow work off the request
 * path. Neither justified BullMQ here.
 *
 * The retry was largely theatre. The webhook that triggers a confirmation email
 * is already idempotent at the database level, so a provider redelivery reaches
 * this code at most once per order regardless. What the queue actually added was
 * a second always-on process and a Redis connection polling around the clock,
 * which is the one thing a free serverless deploy cannot have.
 *
 * ## The two rules that make direct sending safe
 *
 * 1. **Never inside the transaction.** SMTP is a network call to a third party.
 *    Holding a database transaction open across it holds row locks on the
 *    variants for the duration, and a slow mail server would become a stall on
 *    everyone else's checkout.
 * 2. **Never throw.** A paid order must not be rolled back, nor a webhook
 *    answered with a retryable status, because a mail server was down. The money
 *    moved and the stock moved; the email is the least important thing in the
 *    transaction and it is the only part allowed to fail quietly.
 */
@Injectable()
export class OrderEmailService {
  private readonly logger = new Logger(OrderEmailService.name);
  private readonly notifications: NotificationService;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    // Falls back to a log channel when no SMTP host is configured, so a demo
    // deploy with no mail server still completes orders.
    this.notifications = new NotificationService(createChannelFromEnv());
  }

  /** Send an order email. Swallows every failure by design; see the class note. */
  async send(job: OrderEmailJob): Promise<{ sent: boolean; reason?: string }> {
    try {
      const order = await this.prisma.order.findUnique({
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
        orderUrl: `${this.config.appBaseUrl}/orders/${order.id}`,
      };

      await this.notifications.send(job.kind, data);
      return { sent: true };
    } catch (error) {
      this.logger.error(
        `Could not send ${job.kind} for order ${job.orderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { sent: false, reason: 'send failed' };
    }
  }
}
