import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  priceCart,
  type Cart,
  type CartLine,
  type CartLineInput,
  type CartLineSet,
} from '@shop/shared';
import { createStorage, type StorageDriver } from '@shop/storage';
import { CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** Carts outlive a session but not forever. 30 days matches a shopping habit. */
const CART_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Stored shape: ids and quantities only. */
interface StoredLine {
  variantId: string;
  quantity: number;
}

/**
 * Redis-backed cart.
 *
 * Why Redis and not a database table: a cart is high-write, low-value, and must
 * work for a visitor with no account. Storing it in Postgres means a row per
 * anonymous browser and a cleanup job; storing it in Redis means a key with a
 * TTL that expires itself.
 *
 * Crucially, only variant ids and quantities are stored. Prices, titles and
 * stock are resolved from the database on every read. A cart that cached a price
 * would happily charge yesterday's price for today's product, and a cart that
 * cached stock would show a customer availability that no longer exists.
 */
@Injectable()
export class CartService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.storage = createStorage(config.storage);
  }

  private key(cartId: string): string {
    return `cart:${cartId}`;
  }

  private async readLines(cartId: string): Promise<StoredLine[]> {
    const raw = await this.redis.client.get(this.key(cartId));
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // A corrupt or hand-edited value degrades to an empty cart rather than
      // taking down the storefront.
      return parsed.filter(
        (line): line is StoredLine =>
          typeof (line as StoredLine)?.variantId === 'string' &&
          Number.isInteger((line as StoredLine)?.quantity) &&
          (line as StoredLine).quantity > 0,
      );
    } catch {
      return [];
    }
  }

  private async writeLines(cartId: string, lines: StoredLine[]): Promise<void> {
    if (lines.length === 0) {
      await this.redis.client.del(this.key(cartId));
      return;
    }
    await this.redis.client.set(
      this.key(cartId),
      JSON.stringify(lines),
      'EX',
      CART_TTL_SECONDS,
    );
  }

  /** Resolve the stored ids into a fully priced cart. */
  async getCart(cartId: string): Promise<Cart> {
    const stored = await this.readLines(cartId);
    return this.hydrate(cartId, stored);
  }

  async addLine(cartId: string, input: CartLineInput): Promise<Cart> {
    const lines = await this.readLines(cartId);
    const existing = lines.find((line) => line.variantId === input.variantId);

    if (existing) {
      // Adding to an existing line accumulates, capped rather than rejected: a
      // customer clicking "add" twice on the last item wants a full cart, not an
      // error page.
      existing.quantity = Math.min(existing.quantity + input.quantity, MAX_LINE_QUANTITY);
    } else {
      if (lines.length >= MAX_CART_LINES) {
        throw new BadRequestException(`A cart can hold at most ${MAX_CART_LINES} different items.`);
      }
      lines.push({ variantId: input.variantId, quantity: input.quantity });
    }

    await this.writeLines(cartId, lines);
    return this.hydrate(cartId, lines);
  }

  /** Set an exact quantity. Zero removes the line. */
  async setLine(cartId: string, input: CartLineSet): Promise<Cart> {
    const lines = (await this.readLines(cartId)).filter(
      (line) => line.variantId !== input.variantId,
    );
    if (input.quantity > 0) {
      lines.push({ variantId: input.variantId, quantity: input.quantity });
    }
    await this.writeLines(cartId, lines);
    return this.hydrate(cartId, lines);
  }

  async removeLine(cartId: string, variantId: string): Promise<Cart> {
    const lines = (await this.readLines(cartId)).filter((line) => line.variantId !== variantId);
    await this.writeLines(cartId, lines);
    return this.hydrate(cartId, lines);
  }

  async clear(cartId: string): Promise<void> {
    await this.redis.client.del(this.key(cartId));
  }

  /**
   * Merge a guest cart into the user's cart at login. Quantities are summed and
   * capped, and the guest cart is dropped afterwards. Losing the guest cart on
   * sign-in is the single most common way a store loses a sale.
   */
  async merge(guestCartId: string, userCartId: string): Promise<Cart> {
    if (guestCartId === userCartId) return this.getCart(userCartId);

    const [guest, user] = await Promise.all([
      this.readLines(guestCartId),
      this.readLines(userCartId),
    ]);

    const merged = new Map(user.map((line) => [line.variantId, line.quantity]));
    for (const line of guest) {
      const total = (merged.get(line.variantId) ?? 0) + line.quantity;
      merged.set(line.variantId, Math.min(total, MAX_LINE_QUANTITY));
    }

    const lines = [...merged.entries()]
      .slice(0, MAX_CART_LINES)
      .map(([variantId, quantity]) => ({ variantId, quantity }));

    await this.writeLines(userCartId, lines);
    await this.redis.client.del(this.key(guestCartId));
    return this.hydrate(userCartId, lines);
  }

  /**
   * Turn stored ids into a priced cart, dropping lines whose variant or product
   * is no longer purchasable. A deleted or archived product silently disappearing
   * from the cart is better than a checkout that fails at the last step.
   */
  private async hydrate(cartId: string, stored: StoredLine[]): Promise<Cart> {
    if (stored.length === 0) {
      return {
        lines: [],
        currency: this.config.currency,
        subtotalCents: 0,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 0,
        hasStockProblem: false,
      };
    }

    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: stored.map((line) => line.variantId) },
        product: { status: 'ACTIVE' },
      },
      include: {
        product: { include: { images: { orderBy: { position: 'asc' }, take: 1 } } },
      },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));

    const live = stored.filter((line) => byId.has(line.variantId));
    if (live.length !== stored.length) {
      // Prune the stored cart so the customer is not told about the same dead
      // line on every page load.
      await this.writeLines(cartId, live);
    }

    const lines: CartLine[] = live.map((line) => {
      const variant = byId.get(line.variantId)!;
      const available = Math.max(variant.stockOnHand - variant.stockReserved, 0);
      const image = variant.product.images[0];
      return {
        variantId: variant.id,
        quantity: line.quantity,
        productSlug: variant.product.slug,
        productTitle: variant.product.title,
        variantName: variant.name,
        sku: variant.sku,
        unitPriceCents: variant.priceCents,
        lineTotalCents: variant.priceCents * line.quantity,
        imageUrl: image ? this.storage.urlFor(image.storageKey) : null,
        availableStock: available,
        exceedsStock: line.quantity > available,
      };
    });

    const breakdown = priceCart(
      lines.map((line) => ({ unitPriceCents: line.unitPriceCents, quantity: line.quantity })),
      this.config.pricing,
    );

    return {
      lines,
      currency: this.config.currency,
      subtotalCents: breakdown.subtotalCents,
      shippingCents: breakdown.shippingCents,
      taxCents: breakdown.taxCents,
      totalCents: breakdown.totalCents,
      hasStockProblem: lines.some((line) => line.exceedsStock),
    };
  }
}
