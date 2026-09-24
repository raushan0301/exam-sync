-- Supports forcing a password change on first login for accounts
-- provisioned with a deterministic default password (roll_number/
-- employee_code + name) instead of one the user chose. Defaults to false
-- so every existing account is unaffected.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
