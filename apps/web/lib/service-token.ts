import type { Role } from '@shop/shared';
import jwt from 'jsonwebtoken';

/**
 * Mint the short-lived HS256 token the API verifies with the shared AUTH_SECRET.
 *
 * The web server holds the Auth.js session; the API holds no session state at
 * all. This token is the only thing that crosses between them, it lives five
 * minutes, and it carries the role so the API's RolesGuard has something to
 * check without a second round trip to the database.
 */
export function mintServiceToken(userId: string, email: string, role: Role): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return jwt.sign({ sub: userId, email, role }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}
