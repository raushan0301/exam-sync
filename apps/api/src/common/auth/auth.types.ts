/**
 * Shared auth types used by guards/decorators across every module.
 *
 * ARCHITECTURE.md §AF: "role/permission is re-fetched from DB ... not
 * solely from a long-lived JWT claim, to allow immediate revocation."
 * Accordingly, the access-token JWT payload carries only the user id
 * (JwtAccessPayload); AuthenticatedUser (roles included) is assembled by
 * JwtAuthGuard on every request from a fresh DB read, never trusted from
 * the token itself.
 */

export interface JwtAccessPayload {
  sub: string; // user id
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  mustChangePassword: boolean;
}

/** Well-known role names (ARCHITECTURE_REVIEW.md task: initial roles). */
export const ROLE = {
  ADMIN: 'ADMIN',
  FACULTY: 'FACULTY',
  STUDENT: 'STUDENT',
  INVIGILATOR: 'INVIGILATOR',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE] | (string & Record<never, never>);
