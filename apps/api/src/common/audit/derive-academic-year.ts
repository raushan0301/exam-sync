/**
 * Best-effort denormalization of `audit_logs.academic_year`, populated at
 * write time so a future Phase 21 partitioning migration has the range key
 * already backfilled (see `AuditLog`'s own schema.prisma doc comment on
 * why physical partitioning itself is deferred). Many entities carry
 * `academicYear` directly (Quiz, ExamSession's derived fields, etc.); this
 * only looks for that exact field on the snapshot object itself — it does
 * NOT walk relations or query the DB for it, since call sites already pass
 * whatever row shape they have and a cross-entity lookup here would be a
 * much larger, transaction-crossing change outside this phase's scope.
 * Entities with no such field simply get a null `academic_year` (the
 * documented "else created_at" fallback for those rows).
 */
export function deriveAcademicYear(value: unknown): number | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  const candidate = (value as Record<string, unknown>).academicYear;
  return typeof candidate === 'number' ? candidate : null;
}
