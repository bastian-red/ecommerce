import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { checkoutInputSchema, type CheckoutInput, type CheckoutResult } from '@shop/shared';
import jwt from 'jsonwebtoken';
import { Inject } from '@nestjs/common';
import type { AuthedRequest, ServiceTokenPayload } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CONFIG, RATE_LIMITS, type AppConfig } from '../config/config';
import { CheckoutService } from './checkout.service';

const CART_ID_HEADER = 'x-cart-id';
const CART_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Each checkout is a call to the payment gateway, so it gets its own budget. */
const CHECKOUT_RATE_LIMIT = { default: { limit: RATE_LIMITS.checkout, ttl: 60_000 } };

/**
 * Checkout works for guests, so AuthGuard cannot be applied. The token is read
 * optionally instead: present and valid means the order is attached to the
 * account, absent or invalid means a guest order. An invalid token is treated as
 * a guest rather than a 401, because the customer's cart is real and their
 * session expiring mid-checkout must not lose the sale.
 */
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Throttle(CHECKOUT_RATE_LIMIT)
  @Post()
  create(
    @Req() request: AuthedRequest,
    @Headers(CART_ID_HEADER) cartId: string | undefined,
    @Body(new ZodValidationPipe(checkoutInputSchema)) body: CheckoutInput,
  ): Promise<CheckoutResult> {
    if (!cartId || !CART_ID_PATTERN.test(cartId)) {
      throw new BadRequestException(`Missing or malformed ${CART_ID_HEADER} header`);
    }
    return this.checkout.createCheckout(cartId, body, this.optionalUserId(request));
  }

  private optionalUserId(request: AuthedRequest): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload = jwt.verify(header.slice('Bearer '.length), this.config.authSecret, {
        algorithms: ['HS256'],
      }) as ServiceTokenPayload;
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
