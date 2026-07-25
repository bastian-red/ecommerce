import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  cartLineInputSchema,
  cartLineSetSchema,
  cartMergeSchema,
  idSchema,
  type Cart,
  type CartLineInput,
  type CartLineSet,
  type CartMerge,
} from '@shop/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CartService } from './cart.service';

/** Cart ids are opaque and come from a signed cookie the web app manages. */
const CART_ID_HEADER = 'x-cart-id';
const CART_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The cart is identified by a header, not by a session. That is what lets a
 * guest shop without an account, and it is why the id is validated hard here:
 * the value becomes part of a Redis key, so an unvalidated one is a
 * key-injection primitive.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  private requireCartId(value: string | undefined): string {
    if (!value || !CART_ID_PATTERN.test(value)) {
      throw new BadRequestException(`Missing or malformed ${CART_ID_HEADER} header`);
    }
    return value;
  }

  @Get()
  get(@Headers(CART_ID_HEADER) cartId: string | undefined): Promise<Cart> {
    return this.cart.getCart(this.requireCartId(cartId));
  }

  @Post('lines')
  add(
    @Headers(CART_ID_HEADER) cartId: string | undefined,
    @Body(new ZodValidationPipe(cartLineInputSchema)) body: CartLineInput,
  ): Promise<Cart> {
    return this.cart.addLine(this.requireCartId(cartId), body);
  }

  @Put('lines')
  set(
    @Headers(CART_ID_HEADER) cartId: string | undefined,
    @Body(new ZodValidationPipe(cartLineSetSchema)) body: CartLineSet,
  ): Promise<Cart> {
    return this.cart.setLine(this.requireCartId(cartId), body);
  }

  @Delete('lines/:variantId')
  remove(
    @Headers(CART_ID_HEADER) cartId: string | undefined,
    @Param('variantId', new ZodValidationPipe(idSchema)) variantId: string,
  ): Promise<Cart> {
    return this.cart.removeLine(this.requireCartId(cartId), variantId);
  }

  @Delete()
  async clear(@Headers(CART_ID_HEADER) cartId: string | undefined): Promise<{ ok: true }> {
    await this.cart.clear(this.requireCartId(cartId));
    return { ok: true };
  }

  /** Called by the web app right after a successful sign-in. */
  @Post('merge')
  merge(
    @Headers(CART_ID_HEADER) cartId: string | undefined,
    @Body(new ZodValidationPipe(cartMergeSchema)) body: CartMerge,
  ): Promise<Cart> {
    return this.cart.merge(this.requireCartId(body.from), this.requireCartId(cartId));
  }
}
