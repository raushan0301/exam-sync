-- Adds subsection support to batches and widens `year` from an integer to a
-- free-form label so it can hold a span like "2023-2027" for a multi-year
-- program cohort, not just a single calendar year.
--
-- Column order: add `subsection` nullable first, backfill it (existing rows
-- predate this concept — backfilled to match `section`, the closest existing
-- meaning, so no row silently loses its uniqueness under the new composite
-- key), then tighten to NOT NULL. `year` is widened via `::text` — a direct,
-- lossless cast from integer to text, safe for any existing value.
ALTER TABLE "batches" ADD COLUMN "subsection" TEXT;

UPDATE "batches" SET "subsection" = "section" WHERE "subsection" IS NULL;

ALTER TABLE "batches" ALTER COLUMN "subsection" SET NOT NULL;

ALTER TABLE "batches" ALTER COLUMN "year" TYPE TEXT USING "year"::text;

-- Prisma's `@@unique` created this as a plain UNIQUE INDEX (not a named
-- table CONSTRAINT via ADD CONSTRAINT) — confirmed directly against the
-- live database: it does not appear in pg_constraint at all, only in
-- pg_indexes. `DROP CONSTRAINT` therefore cannot find it (errors 42704
-- "constraint ... does not exist") even though `\d batches` lists it under
-- "Indexes:" looking identical to a constraint. Use DROP INDEX instead.
DROP INDEX "batches_program_id_year_section_key";

ALTER TABLE "batches" ADD CONSTRAINT "batches_program_id_year_section_subsection_key"
  UNIQUE ("program_id", "year", "section", "subsection");
