import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring authentication (login, refresh).
 * Everything else is authenticated by default via the global JwtAuthGuard
 * (AGENT_DEVELOPMENT_RULES.md rule 5: never bypass authorization by
 * omission — the safe default is "requires auth", opting out is explicit).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
