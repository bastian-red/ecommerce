import type { Cart } from '@shop/shared';
import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { cartApiFetch, getCartId } from '../../../lib/api';

/**
 * Everything the nav needs, in one request.
 *
 * It exists so the root layout never calls `cookies()` or `auth()`. Either of
 * those in a layout opts every page beneath it out of static rendering, which
 * would silently turn the ISR catalog pages into server-rendered ones. A route
 * handler is dynamic by nature, so the dynamic part is isolated here.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await auth();

  let cartCount = 0;
  const cartId = await getCartId(false);
  if (cartId) {
    try {
      const cart = await cartApiFetch<Cart>(cartId, '/cart');
      cartCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
    } catch {
      // A cart the API cannot serve reads as empty rather than as an error in
      // the header of every page.
    }
  }

  return NextResponse.json({
    signedIn: Boolean(session?.user),
    isAdmin: session?.user?.role === 'ADMIN',
    cartCount,
  });
}
