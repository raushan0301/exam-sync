import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';

/**
 * Marks a route as reachable even when the authenticated user has
 * `mustChangePassword: true` — otherwise JwtAuthGuard blocks every
 * authenticated route until that's cleared (see its enforcement there).
 * Only `POST /auth/change-password` itself and `POST /auth/logout` should
 * ever use this: the whole point is that nothing else is usable with a
 * standing default password.
 */
export const AllowWhenPasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
