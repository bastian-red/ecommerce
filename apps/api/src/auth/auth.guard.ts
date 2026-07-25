import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Role } from '@shop/shared';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG, type AppConfig } from '../config/config';

export interface ServiceTokenPayload {
  /** User id. */
  sub: string;
  email: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: Role };
}

/**
 * Verifies the short-lived HS256 service token the web app mints from the shared
 * AUTH_SECRET, and attaches the user to the request.
 *
 * The web app owns the Auth.js session cookie; the API never sees it. That split
 * means the API has no session store, no cookie parsing and no CSRF surface: it
 * only ever accepts a bearer token it can verify with a secret it already holds.
 *
 * `algorithms: ['HS256']` is not decoration. Without it, a token with
 * `"alg": "none"` verifies against any secret, which is the oldest JWT bypass
 * there is.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = jwt.verify(header.slice('Bearer '.length), this.config.authSecret, {
        algorithms: ['HS256'],
      }) as ServiceTokenPayload;
      if (!payload.sub) throw new Error('token has no subject');
      request.user = {
        id: payload.sub,
        email: payload.email,
        // A token with no role is treated as a customer. Defaulting the other
        // way would turn a malformed token into an admin.
        role: payload.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
