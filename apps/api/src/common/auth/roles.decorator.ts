import { SetMetadata } from '@nestjs/common';
import { RoleName } from './auth.types';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may call this route. Evaluated by RolesGuard against
 * the roles JwtAuthGuard freshly loaded from the DB for this request.
 *
 * Role-level only — this decorator alone does NOT provide resource-level
 * authorization (e.g. "this specific quiz belongs to this faculty"). That is
 * the responsibility of ScopedRepository (see
 * common/authorization/scoped-repository.ts, docs/adr/008), which every
 * future entity-fetching method must be built on (ARCHITECTURE_REVIEW.md §10).
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
