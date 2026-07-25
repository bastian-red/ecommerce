import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@shop/shared';
import { describe, expect, it } from 'vitest';
import type { AuthedRequest } from './auth.guard';
import { RolesGuard } from './roles.guard';

function guardWith(required: Role[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function contextFor(user: AuthedRequest['user']): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const admin = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };
const customer = { id: 'u2', email: 'c@d.e', role: 'CUSTOMER' as const };

describe('RolesGuard', () => {
  it('admits a user holding the required role', () => {
    expect(guardWith(['ADMIN']).canActivate(contextFor(admin))).toBe(true);
  });

  it('refuses a user without it', () => {
    expect(() => guardWith(['ADMIN']).canActivate(contextFor(customer))).toThrow(
      ForbiddenException,
    );
  });

  it('admits when any one of several roles matches', () => {
    expect(guardWith(['ADMIN', 'CUSTOMER']).canActivate(contextFor(customer))).toBe(true);
  });

  it('fails closed when no role metadata is declared', () => {
    // A guard that permits on missing metadata does nothing the day someone
    // forgets the decorator, which would be the whole admin panel open.
    expect(() => guardWith(undefined).canActivate(contextFor(admin))).toThrow(ForbiddenException);
  });

  it('fails closed on an empty role list', () => {
    expect(() => guardWith([]).canActivate(contextFor(admin))).toThrow(ForbiddenException);
  });

  it('refuses a request with no authenticated user', () => {
    expect(() => guardWith(['ADMIN']).canActivate(contextFor(undefined))).toThrow(
      /Not authenticated/,
    );
  });
});
