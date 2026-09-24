-- Widens subjects.credits from integer to double precision so half-credit
-- subjects (e.g. 3.5, 4.5) can be recorded, not just whole numbers. A direct
-- ::double precision cast is lossless for every existing integer value.
ALTER TABLE "subjects" ALTER COLUMN "credits" TYPE DOUBLE PRECISION USING "credits"::double precision;
