import { cookies } from 'next/headers';
import { auth } from '../auth';
import { CART_COOKIE, CART_COOKIE_MAX_AGE, createSignedCartId, readSignedCartId } from './cart-id';
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** The API's structured body, when it sent one (checkout errors carry details). */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = response.statusText;
    let body: unknown;
    try {
      body = await response.json();
      const record = body as { message?: unknown };
      if (typeof record.message === 'string') message = record.message;
      // Checkout failures nest their contract inside `message`.
      else if (record.message && typeof record.message === 'object') {
        body = record.message;
        message = (record.message as { message?: string }).message ?? message;
      }
    } catch {
      // A non-JSON error body is not worth failing over; the status is enough.
    }
    throw new ApiError(response.status, message, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Public server-side call. No auth, no cart. */
export async function publicApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  return parse<T>(response);
}

/**
 * Cached public call, for catalog reads that feed ISR pages. Tagged so an admin
 * edit can invalidate exactly the affected pages with `revalidateTag`, rather
 * than waiting out a fixed window or rebuilding the whole site.
 */
export async function cachedApiFetch<T>(
  path: string,
  tags: string[],
  revalidateSeconds = 60,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    next: { tags, revalidate: revalidateSeconds },
  });
  return parse<T>(response);
}

/** Authenticated server-side call as the signed-in user. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await auth();
  if (!session?.user) throw new ApiError(401, 'Not authenticated');
  const { mintServiceToken } = await import('./service-token');
  const token = mintServiceToken(session.user.id, session.user.email, session.user.role);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  return parse<T>(response);
}

/**
 * Read the caller's cart id, minting one if this is their first visit.
 *
 * `create: false` is the read-only variant, for Server Components: Next.js
 * forbids writing a cookie during render, so a page that only displays the cart
 * must not try to mint one. Server Actions and Route Handlers pass `true`.
 */
export async function getCartId(create: boolean): Promise<string | null> {
  const store = await cookies();
  const existing = readSignedCartId(store.get(CART_COOKIE)?.value);
  if (existing) return existing;
  if (!create) return null;

  const { id, cookieValue } = createSignedCartId();
  store.set(CART_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE,
  });
  return id;
}

/** Server-side call carrying the cart header, with the user token when present. */
export async function cartApiFetch<T>(
  cartId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = await auth();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-cart-id': cartId,
  };
  if (session?.user) {
    const { mintServiceToken } = await import('./service-token');
    headers.authorization = `Bearer ${mintServiceToken(
      session.user.id,
      session.user.email,
      session.user.role,
    )}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  return parse<T>(response);
}
