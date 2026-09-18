-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "academic_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 20 / ARCHITECTURE_REVIEW.md §5 + §10 item 7: BR-049 ("audit log
-- rows are append-only; no update or delete operation exists against
-- audit_logs in the application layer") is an application-layer design
-- intent, not a technical guarantee on its own. This section is the
-- defense-in-depth backstop the review calls for: even a future bug or a
-- compromised application DB credential cannot UPDATE or DELETE existing
-- rows, only INSERT new ones.
--
-- REVOKE DELETE is straightforward: the application's own runtime role
-- never needs to delete a row here, so DELETE is revoked outright.
-- Uses `CURRENT_USER` rather than a literal role name so this migration
-- is portable across environments — it revokes DELETE from whichever
-- role actually runs `prisma migrate deploy`, which in this project's
-- convention is the same role the application connects as (locally
-- "exam_sync" per .env DATABASE_URL; on a hosted Postgres such as
-- Supabase, whatever role that connection uses, e.g. "postgres"). An
-- earlier version of this migration hardcoded the literal name
-- "exam_sync", which failed with "role \"exam_sync\" does not exist" on
-- any database using a different role (confirmed against a real Supabase
-- Session Pooler connection, role "postgres") — `CURRENT_USER` fixes
-- this without weakening the guarantee: it still revokes DELETE from
-- exactly the role that will actually run the application in that
-- environment, just resolved dynamically instead of assumed in advance.
--
-- UPDATE is deliberately NOT revoked via GRANT/REVOKE — a genuine
-- PostgreSQL gotcha discovered while writing this migration's own e2e
-- test: enforcing `audit_logs_actor_id_fkey`'s RESTRICT action (blocking
-- deletion of a still-referenced `users` row) requires PostgreSQL to take
-- a `FOR KEY SHARE` row lock on the referencing `audit_logs` rows, and
-- acquiring ANY row lock in PostgreSQL — even for a read-only check, no
-- data is modified — requires the UPDATE privilege on that table. Revoking
-- UPDATE therefore does not just block genuine tampering; it silently
-- breaks the FK constraint's own RESTRICT enforcement with a bare
-- "permission denied for table audit_logs" instead of the intended
-- foreign-key-violation error, for ANY attempt to delete a `users` row
-- that has ever acted (a near-certainty for any real user, and exactly
-- what this project's own e2e test cleanup — and any real admin
-- deactivation flow, though this codebase's own established convention
-- is to deactivate via `is_active`, never hard-delete a User — would hit).
--
-- The fix used here instead: keep UPDATE granted (so the lock-only FK
-- check keeps working), and add a BEFORE UPDATE trigger that
-- unconditionally rejects any actual UPDATE statement against this
-- table. A `FOR KEY SHARE` row lock does not fire row-level UPDATE
-- triggers (no row is actually modified), so this blocks every real
-- tampering attempt while leaving the FK machinery intact — verified
-- directly against this database before being written into this
-- migration.
--
-- Hand-authored raw SQL (not something `prisma migrate diff` can express
-- from schema.prisma) — same "hand-edit the generated migration.sql"
-- technique already established in this project for CHECK constraints and
-- GiST exclusion constraints (Phases 6/8/12/13/18).
REVOKE DELETE ON "audit_logs" FROM CURRENT_USER;

CREATE OR REPLACE FUNCTION audit_logs_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: UPDATE is not permitted (BR-049)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_reject_update();
