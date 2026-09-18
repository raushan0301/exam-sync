import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';

/**
 * Resource-level authorization base (docs/adr/008-rbac-resource-level-authorization.md).
 *
 * RBAC (JwtAuthGuard + RolesGuard) answers "is this role allowed to call
 * this endpoint at all?" It cannot answer "is this specific student allowed
 * to see *this* attendance row?" — that requires fetching the row and
 * checking ownership/scope, which is what this base class structurally
 * forces every future entity-fetching service to do.
 *
 * Every module from Phase 2 onward that exposes a "get one resource by id"
 * operation should implement this instead of writing an ad hoc
 * `if (resource.ownerId !== actor.id)` check inline — ad hoc checks are
 * exactly how IDOR vulnerabilities get missed on one endpoint out of sixty
 * (ADR-008's stated rationale).
 *
 * Deliberate design choices, both taken directly from ADR-008:
 *  - An unauthorized access attempt returns 404, not 403. This avoids
 *    confirming to an unauthorized caller that the resource exists at all
 *    (BUSINESS_RULES.md BR-045/046, EDGE_CASES.md EC-038/039).
 *  - Admin bypass is explicit per-subclass (`isAdminBypass`), not implicit,
 *    so a subclass can define an admin-restricted resource type if one ever
 *    exists (none do yet, but the hook is here rather than hardcoded).
 *
 * Phase 1 has no domain entities to scope yet (students/faculty/quizzes
 * etc. land in later phases) — this class exists now, unused by any real
 * entity, specifically so Phase 2+ modules build on it from their first
 * commit rather than each inventing their own pattern
 * (IMPLEMENTATION_PLAN.md Phase 1 backend-work note, ARCHITECTURE_REVIEW.md §10).
 */
export abstract class ScopedRepository<TEntity> {
  /** Fetch the entity by id with no authorization applied. */
  protected abstract findByIdUnscoped(id: string): Promise<TEntity | null>;

  /**
   * True if `actor` owns/is-authorized-for this specific entity instance.
   * May return a Promise — added in Phase 5, where "is this faculty
   * authorized to see this student" requires an async lookup against
   * faculty_subject_batch_assignment, not just a synchronous field
   * comparison. Existing synchronous subclasses (Phase 3/4) are untouched:
   * a plain `boolean` return still satisfies `boolean | Promise<boolean>`.
   */
  protected abstract isOwnedByActor(
    entity: TEntity,
    actor: AuthenticatedUser,
  ): boolean | Promise<boolean>;

  /**
   * True if `actor`'s role(s) bypass the ownership check entirely for this
   * entity type (e.g. ADMIN can read any quiz). Defaults to false; override
   * per subclass as the domain requires.
   */
  protected isAdminBypass(_actor: AuthenticatedUser): boolean {
    return false;
  }

  /**
   * Fetch `id`, scoped to `actor`. Throws NotFoundException (404) if the
   * entity doesn't exist OR exists but `actor` isn't authorized for it —
   * the two cases are indistinguishable to the caller by design.
   */
  async findScoped(id: string, actor: AuthenticatedUser): Promise<TEntity> {
    const entity = await this.findByIdUnscoped(id);
    if (!entity) {
      throw new NotFoundException();
    }
    if (!this.isAdminBypass(actor) && !(await this.isOwnedByActor(entity, actor))) {
      throw new NotFoundException();
    }
    return entity;
  }
}
