import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './auth.types';

/** Injects the authenticated user (set by JwtAuthGuard) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
