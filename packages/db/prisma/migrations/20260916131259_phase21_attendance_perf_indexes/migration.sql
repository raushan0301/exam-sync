-- Phase 21 (Performance Optimization).
--
-- The `attendance` table had zero non-PK/non-unique indexes. Every list
-- query (AttendanceService.listForSession, .getHistoryForStudent), which
-- all ORDER BY marked_at desc and the faculty-scoped variant of
-- listForSession additionally filters via seat.roomId (joining through
-- seat_id), forced a Seq Scan on the full attendance table.
--
-- Verified with EXPLAIN ANALYZE against a 5,000-row synthetic dataset:
--   listForSession (admin):            6.25ms Seq Scan+Sort -> 0.25ms Index Scan
--   listForSession (faculty/room filter): 15.99ms Seq Scan+Sort -> 0.71ms Index Scan
-- Both eliminated the Seq Scan on attendance entirely post-index.
CREATE INDEX "attendance_marked_at_idx" ON "attendance" ("marked_at" DESC);

CREATE INDEX "attendance_seat_id_idx" ON "attendance" ("seat_id");
