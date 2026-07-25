import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A capability token for a guest's own order.
 *
 * A guest checkout has no session, so the confirmation link the gateway sends
 * them back to has to carry proof of access. Two obvious options were rejected:
 *
 *  - Nothing at all. Then order ids become a public feed of other people's
 *    names, addresses and purchases to anyone who can enumerate a cuid.
 *  - The customer's email in the query string. It works, but it writes PII into
 *    browser history, referrer headers, and every proxy and access log between
 *    here and the customer.
 *
 * So: an HMAC of the order id under AUTH_SECRET. Unguessable without the secret,
 * carries no personal data, needs no storage, and stays valid for the life of
 * the order, which is exactly what a confirmation link needs.
 */
export function mintOrderAccessToken(orderId: string, secret: string): string {
  return createHmac('sha256', secret).update(`order:${orderId}`).digest('base64url');
}

export function verifyOrderAccessToken(
  orderId: string,
  token: string | undefined,
  secret: string,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(mintOrderAccessToken(orderId, secret), 'utf8');
  const provided = Buffer.from(token, 'utf8');
  // Length is checked first because timingSafeEqual throws on a mismatch, and a
  // MAC's length is not a secret.
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
