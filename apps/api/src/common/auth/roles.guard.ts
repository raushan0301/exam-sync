import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedUser } from './auth.types';

/**
 * Role-level authorization only (ADR-008). Runs after JwtAuthGuard has
 * populated request.user. A route with no @Roles(...) metadata is allowed
 * for any authenticated user — role-restriction is opt-in per route via the
 * decorator, matching API_CONTRACT.md's per-endpoint "Auth" column.
 *
 * This guard deliberately does NOT and cannot perform resource-level checks
 * (e.g. "is this the caller's own quiz") — that requires the specific
 * resource id and domain knowledge this generic guard doesn't have. See
 * common/authorization/scoped-repository.ts for that layer.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user || !requiredRoles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
