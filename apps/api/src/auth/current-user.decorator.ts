import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@shop/shared';
import type { AuthedRequest } from './auth.guard';

export interface CurrentUserInfo {
  id: string;
  email: string;
  role: Role;
}

/** Injects the user resolved by AuthGuard. Only valid on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserInfo => {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) {
      // Reaching here means a handler used @CurrentUser without AuthGuard, which
      // is a wiring bug rather than a client error.
      throw new Error('CurrentUser used on a route without AuthGuard');
    }
    return user;
  },
);
