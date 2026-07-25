import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@shop/shared';
import type { AuthedRequest } from './auth.guard';

export const ROLES_KEY = 'roles';

/** Restrict a controller or handler to the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Role check, run after AuthGuard has populated `request.user`.
 *
 * It fails closed twice over: no metadata means no access rather than open
 * access, and a request with no user is refused rather than treated as
 * anonymous-but-allowed. A roles guard that defaults to permitting is a roles
 * guard that does nothing the day someone forgets the decorator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      throw new ForbiddenException('No role requirement declared for this route');
    }
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
