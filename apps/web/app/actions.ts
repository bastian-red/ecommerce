'use server';

import type { Cart, CheckoutError, CheckoutResult } from '@shop/shared';
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, cartApiFetch, getCartId } from '../lib/api';

/**
 * Server Actions are the only place the browser can mutate anything.
 *
 * No client component ever holds a token or calls the API directly: the browser
 * posts to this server, this server mints a five-minute service token, and the
 * API sees a request it can verify. That keeps AUTH_SECRET on the server and
 * means the API needs no CORS credentials path for the browser at all.
 */

export interface ActionState {
  error?: string;
  /** Structured checkout failure, so the cart can name the item that ran out. */
  checkoutError?: CheckoutError;
}

async function requireCartId(): Promise<string> {
  const cartId = await getCartId(true);
  if (!cartId) throw new Error('Could not establish a cart');
  return cartId;
}

export async function addToCart(variantId: string, quantity: number): Promise<ActionState> {
  try {
    const cartId = await requireCartId();
    await cartApiFetch<Cart>(cartId, '/cart/lines', {
      method: 'POST',
      body: JSON.stringify({ variantId, quantity }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not add that item.' };
  }
  revalidatePath('/cart');
  return {};
}

export async function setCartQuantity(variantId: string, quantity: number): Promise<ActionState> {
  try {
    const cartId = await requireCartId();
    await cartApiFetch<Cart>(cartId, '/cart/lines', {
      method: 'PUT',
      body: JSON.stringify({ variantId, quantity }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not update the cart.' };
  }
  revalidatePath('/cart');
  return {};
}

/** Empty the cart. Called from the confirmation page once an order is paid. */
export async function clearCart(): Promise<ActionState> {
  try {
    const cartId = await getCartId(false);
    if (!cartId) return {};
    await cartApiFetch<void>(cartId, '/cart', { method: 'DELETE' });
  } catch {
    // A cart that fails to clear is a cosmetic problem on a completed order.
    // It must never surface as an error on a confirmation page.
    return {};
  }
  revalidatePath('/cart');
  return {};
}

export async function removeFromCart(variantId: string): Promise<ActionState> {
  try {
    const cartId = await requireCartId();
    await cartApiFetch<Cart>(cartId, `/cart/lines/${variantId}`, { method: 'DELETE' });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not remove that item.' };
  }
  revalidatePath('/cart');
  return {};
}

/**
 * Start checkout and hand the browser to the gateway.
 *
 * The redirect is deliberately outside the try/catch: Next.js implements
 * `redirect()` by throwing, so catching around it would swallow the navigation
 * and leave the customer staring at a form that appeared to do nothing.
 */
export async function startCheckout(formData: FormData): Promise<ActionState> {
  let result: CheckoutResult;
  try {
    const cartId = await requireCartId();
    result = await cartApiFetch<CheckoutResult>(cartId, '/checkout', {
      method: 'POST',
      body: JSON.stringify({
        email: String(formData.get('email') ?? ''),
        shippingAddress: {
          name: String(formData.get('name') ?? ''),
          line1: String(formData.get('line1') ?? ''),
          city: String(formData.get('city') ?? ''),
          postalCode: String(formData.get('postalCode') ?? ''),
          country: String(formData.get('country') ?? ''),
        },
      }),
    });
  } catch (error) {
    if (error instanceof ApiError && isCheckoutError(error.body)) {
      return { checkoutError: error.body, error: error.body.message };
    }
    return {
      error: error instanceof ApiError ? error.message : 'Could not start checkout.',
    };
  }
  redirect(result.checkoutUrl);
}

function isCheckoutError(body: unknown): body is CheckoutError {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as CheckoutError).code === 'string' &&
    Array.isArray((body as CheckoutError).details)
  );
}

/**
 * Fold the guest cart into the signed-in user's cart. Called from the login page
 * after a successful sign-in, because that is the moment the guest cart would
 * otherwise be orphaned.
 */
export async function mergeGuestCart(guestCartId: string): Promise<void> {
  try {
    const cartId = await requireCartId();
    if (cartId === guestCartId) return;
    await cartApiFetch<Cart>(cartId, '/cart/merge', {
      method: 'POST',
      body: JSON.stringify({ from: guestCartId }),
    });
    revalidatePath('/cart');
  } catch {
    // A failed merge must never block a sign-in. The worst case is a customer
    // who has to re-add an item, which beats an error page on login.
  }
}

// ---- Admin actions ----

export async function adminFulfillOrder(orderId: string): Promise<ActionState> {
  try {
    await apiFetch(`/admin/orders/${orderId}/fulfill`, { method: 'POST' });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not fulfil that order.' };
  }
  revalidatePath('/admin/orders');
  return {};
}

export async function adminChangeStock(
  variantId: string,
  kind: 'RESTOCK' | 'ADJUST',
  quantity: number,
  reason: string,
): Promise<ActionState> {
  try {
    await apiFetch(`/admin/variants/${variantId}/stock`, {
      method: 'POST',
      body: JSON.stringify({ kind, quantity, reason }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not change stock.' };
  }
  // A stock change moves availability on the storefront, so the cached catalog
  // pages are invalidated by tag rather than left to expire.
  revalidateTag('catalog');
  revalidatePath('/admin/stock');
  return {};
}

export async function adminCreateProduct(formData: FormData): Promise<ActionState> {
  try {
    await apiFetch('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        slug: String(formData.get('slug') ?? ''),
        title: String(formData.get('title') ?? ''),
        description: String(formData.get('description') ?? ''),
        status: String(formData.get('status') ?? 'DRAFT'),
        categoryId: formData.get('categoryId') ? String(formData.get('categoryId')) : null,
      }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not create the product.' };
  }
  revalidateTag('catalog');
  revalidatePath('/admin/products');
  return {};
}

export async function adminUpdateProductStatus(
  productId: string,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
): Promise<ActionState> {
  try {
    await apiFetch(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not update the product.' };
  }
  revalidateTag('catalog');
  revalidatePath('/admin/products');
  return {};
}

export async function adminCreateVariant(
  productId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    await apiFetch(`/admin/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify({
        sku: String(formData.get('sku') ?? '').toUpperCase(),
        name: String(formData.get('name') ?? ''),
        priceCents: Number(formData.get('priceCents') ?? 0),
        stockOnHand: Number(formData.get('stockOnHand') ?? 0),
        position: Number(formData.get('position') ?? 0),
      }),
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not create the variant.' };
  }
  revalidateTag('catalog');
  revalidatePath(`/admin/products/${productId}`);
  return {};
}
