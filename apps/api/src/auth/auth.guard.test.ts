import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config';
import { AuthGuard, type AuthedRequest } from './auth.guard';

const SECRET = 'test-auth-secret-at-least-16-chars';
const config = { authSecret: SECRET } as AppConfig;
const guard = new AuthGuard(config);

function contextFor(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function bearer(payload: Record<string, unknown>, secret = SECRET): AuthedRequest {
  return {
    headers: { authorization: `Bearer ${jwt.sign(payload, secret, { algorithm: 'HS256' })}` },
  } as unknown as AuthedRequest;
}

describe('AuthGuard', () => {
  it('accepts a valid token and attaches the user', () => {
    const request = bearer({ sub: 'user_1', email: 'a@b.c', role: 'CUSTOMER' });
    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toEqual({ id: 'user_1', email: 'a@b.c', role: 'CUSTOMER' });
  });

  it('carries the admin role through', () => {
    const request = bearer({ sub: 'user_1', email: 'a@b.c', role: 'ADMIN' });
    guard.canActivate(contextFor(request));
    expect(request.user?.role).toBe('ADMIN');
  });

  it('defaults an unknown role to CUSTOMER, never to ADMIN', () => {
    const request = bearer({ sub: 'user_1', email: 'a@b.c', role: 'SUPERUSER' });
    guard.canActivate(contextFor(request));
    expect(request.user?.role).toBe('CUSTOMER');
  });

  it('defaults a missing role to CUSTOMER', () => {
    const request = bearer({ sub: 'user_1', email: 'a@b.c' });
    guard.canActivate(contextFor(request));
    expect(request.user?.role).toBe('CUSTOMER');
  });

  it('rejects a missing header', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} } as AuthedRequest))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-bearer scheme', () => {
    const request = { headers: { authorization: 'Basic abc' } } as unknown as AuthedRequest;
    expect(() => guard.canActivate(contextFor(request))).toThrow(/Missing bearer token/);
  });

  it('rejects a token signed with a different secret', () => {
    const request = bearer({ sub: 'user_1' }, 'a-completely-different-secret-value');
    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ sub: 'user_1' }, SECRET, { algorithm: 'HS256', expiresIn: '-1s' });
    const request = { headers: { authorization: `Bearer ${token}` } } as unknown as AuthedRequest;
    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects an alg:none token, the classic JWT bypass', () => {
    // Without algorithms: ['HS256'] this token verifies against any secret.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user_1', role: 'ADMIN' })).toString('base64url');
    const request = {
      headers: { authorization: `Bearer ${header}.${body}.` },
    } as unknown as AuthedRequest;
    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects a token with no subject', () => {
    const request = bearer({ email: 'a@b.c', role: 'ADMIN' });
    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });

  it('rejects a structurally invalid token', () => {
    const request = { headers: { authorization: 'Bearer not.a.jwt' } } as unknown as AuthedRequest;
    expect(() => guard.canActivate(contextFor(request))).toThrow(UnauthorizedException);
  });
});
