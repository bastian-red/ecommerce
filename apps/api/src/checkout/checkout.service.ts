import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { PaymentGateway } from '@shop/payments';
import {
  priceCart,
  type CheckoutError,
  type CheckoutInput,
  type CheckoutResult,
  type InsufficientStockDetail,
} from '@shop/shared';
import { CartService } from '../cart/cart.service';
import { CONFIG, type AppConfig } from '../config/config';
import { PAYMENTS } from '../core/core.module';
import { InventoryService, type StockLine } from '../inventory/inventory.service';
import { ReservationSweepService } from '../inventory/reservation-sweep.service';
import { mintOrderAccessToken } from '../orders/order-access-token';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Checkout: turn a cart into a PENDING order that holds stock, then hand the
 * customer to the payment gateway.
 *
 * ## The three-phase shape, and why it is not one transaction
 *
 * 1. Transaction: create the order, snapshot its lines, reserve the stock.
 * 2. Network: ask the gateway for a checkout session.
 * 3. Transaction: record the Payment row with the session id.
 *
 * Phase 2 is a call to a third party that can take seconds or hang. Holding a
 * database transaction open across it would hold row locks on the variants for
 * that whole time, and every other customer trying to buy the same product would
 * queue behind Stripe's latency. So the reservation commits first.
 *
 * The cost of that choice is a window where an order holds stock but has no
 * gateway session. That is handled, not ignored: if phase 2 fails the order is
 * cancelled and the stock released immediately, and if the process dies between
 * the phases the reservation carries a TTL that `ReservationSweepService`
 * reclaims. Stock is never stranded, only briefly held.
 *
 * ## Prices are re-read, never trusted from the client
 *
 * The cart the browser holds is a display artefact. Every price here comes from
 * the variant rows read inside the transaction, and the total is computed by the
 * same `priceCart` the storefront uses. A client that posts its own total gets
 * it ignored.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
    private readonly sweep: ReservationSweepService,
    @Inject(PAYMENTS) private readonly gateway: PaymentGateway,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async createCheckout(
    cartId: string,
    input: CheckoutInput,
    userId: string | null,
  ): Promise<CheckoutResult> {
    const cart = await this.cart.getCart(cartId);
    if (cart.lines.length === 0) {
      throw new BadRequestException(this.error('CART_EMPTY', 'Your cart is empty.'));
    }

    // Reclaim stock from reservations that have outlived their TTL, before
    // asking whether there is any. This is the lazy half of the expiry
    // mechanism, and it runs here because this is the only moment a stale
    // reservation actually costs anything: it is standing between a real
    // customer and stock they want. It never throws.
    await this.sweep.sweepQuietly();

    const expiresAt = new Date(Date.now() + this.config.reservationTtlMinutes * 60_000);
    const stockLines: StockLine[] = cart.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
    }));

    // Phase 1: reserve, atomically.
    const created = await this.prisma.$transaction(async (tx) => {
      // Prices are re-read here, inside the transaction, rather than taken from
      // the hydrated cart: between hydration and now an admin may have changed
      // one, and the order must record what is true at reservation time.
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: stockLines.map((line) => line.variantId) },
          product: { status: 'ACTIVE' },
        },
        include: { product: { select: { title: true } } },
      });
      const byId = new Map(variants.map((variant) => [variant.id, variant]));

      const missing = stockLines.filter((line) => !byId.has(line.variantId));
      if (missing.length > 0) {
        throw new BadRequestException(
          this.error(
            'VARIANT_UNAVAILABLE',
            'One or more items are no longer available. Please review your cart.',
          ),
        );
      }

      const breakdown = priceCart(
        stockLines.map((line) => ({
          unitPriceCents: byId.get(line.variantId)!.priceCents,
          quantity: line.quantity,
        })),
        this.config.pricing,
      );

      const [{ number }] = await tx.$queryRaw<Array<{ number: string }>>`
        SELECT 'SHOP-' || nextval('order_number_seq')::text AS number`;

      const order = await tx.order.create({
        data: {
          number,
          userId,
          email: input.email.toLowerCase(),
          status: 'PENDING',
          currency: this.config.currency,
          subtotalCents: breakdown.subtotalCents,
          taxCents: breakdown.taxCents,
          shippingCents: breakdown.shippingCents,
          totalCents: breakdown.totalCents,
          reservationExpiresAt: expiresAt,
          shippingName: input.shippingAddress.name,
          shippingLine1: input.shippingAddress.line1,
          shippingCity: input.shippingAddress.city,
          shippingPostalCode: input.shippingAddress.postalCode,
          shippingCountry: input.shippingAddress.country,
          items: {
            create: stockLines.map((line) => {
              const variant = byId.get(line.variantId)!;
              return {
                variantId: variant.id,
                // Snapshotted so the order stays readable after the catalog
                // changes underneath it.
                productTitle: variant.product.title,
                variantName: variant.name,
                sku: variant.sku,
                unitPriceCents: variant.priceCents,
                quantity: line.quantity,
                lineTotalCents: variant.priceCents * line.quantity,
              };
            }),
          },
        },
        include: { items: true },
      });

      const failures = await this.inventory.reserve(tx, order.id, stockLines);
      if (failures.length > 0) {
        // Throwing rolls back the order and every reservation made above, so a
        // partially satisfiable cart reserves nothing at all.
        const details: InsufficientStockDetail[] = failures.map((failure) => {
          const variant = byId.get(failure.variantId)!;
          return {
            variantId: failure.variantId,
            sku: variant.sku,
            productTitle: variant.product.title,
            variantName: variant.name,
            requested: failure.requested,
            available: failure.available,
          };
        });
        throw new ConflictException(
          this.error('INSUFFICIENT_STOCK', 'Some items are no longer in stock.', details),
        );
      }

      return order;
    });

    // Phase 2: the gateway call, outside the transaction.
    let session;
    try {
      session = await this.gateway.createCheckoutSession({
        orderId: created.id,
        orderNumber: created.number,
        email: created.email,
        currency: created.currency,
        lineItems: created.items.map((item) => ({
          name: item.productTitle,
          description: item.variantName,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
        })),
        shippingCents: created.shippingCents,
        taxCents: created.taxCents,
        // The access token is what lets a guest, who has no session, open their
        // own confirmation page. See orders/order-access-token.ts.
        successUrl:
          `${this.config.appBaseUrl}/orders/${created.id}?paid=1` +
          `&t=${mintOrderAccessToken(created.id, this.config.authSecret)}`,
        cancelUrl: `${this.config.appBaseUrl}/cart?cancelled=${created.id}`,
        expiresAt,
      });
    } catch (error) {
      // The gateway is down or rejected us. Release immediately rather than
      // leaving stock held for the full TTL behind an order nobody can pay.
      this.logger.error(
        `Gateway session failed for ${created.number}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.cancelAndRelease(created.id, 'gateway-session-failed');
      throw new BadRequestException('Could not start checkout. Please try again.');
    }

    // Phase 3: record the payment attempt.
    await this.prisma.payment.create({
      data: {
        orderId: created.id,
        provider: this.gateway.name,
        sessionId: session.sessionId,
        status: 'PENDING',
        amountCents: created.totalCents,
        currency: created.currency,
      },
    });

    return {
      orderId: created.id,
      orderNumber: created.number,
      checkoutUrl: session.url,
      sessionId: session.sessionId,
      totalCents: created.totalCents,
      currency: created.currency,
      reservationExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Cancel a PENDING order and put its stock back. Guarded on the current status
   * so it cannot cancel an order that was paid in the meantime, and idempotent:
   * a second call updates zero rows and releases nothing.
   */
  async cancelAndRelease(orderId: string, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.$executeRaw`
        UPDATE "orders"
           SET "status" = 'CANCELLED'::"OrderStatus",
               "closed_at" = NOW(),
               "updated_at" = NOW()
         WHERE "id" = ${orderId}
           AND "status" = 'PENDING'::"OrderStatus"`;
      if (cancelled === 0) return false;

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { variantId: true, quantity: true },
      });
      await this.inventory.release(tx, orderId, items, reason);
      return true;
    });
  }

  private error(
    code: CheckoutError['code'],
    message: string,
    details: InsufficientStockDetail[] = [],
  ): CheckoutError {
    return { code, message, details };
  }
}
