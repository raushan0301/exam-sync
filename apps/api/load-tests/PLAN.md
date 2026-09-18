# Phase 23 — Load Test Plan

Targets cited verbatim from `docs/ARCHITECTURE.md`:

- §"Latency (p95)" (line ~44): Reads < 300ms, writes < 500ms, seating generation async.
- §AK/AL/AM/AN "Performance targets (p95)" table (line ~878-884):
  - Dashboard load < 300ms (sync, cached)
  - Quiz create/submit < 400ms (sync)
  - Approval action < 300ms (sync)
  - Conflict detection < 500ms (sync)
  - (attendance mark target of <200ms cited in the task brief was NOT found verbatim in
    the current ARCHITECTURE.md performance table as read on 2026-09-16 — the table only
    lists the four rows above. Rather than invent a number, attendance is evaluated
    against the general write target "<500ms" from the top-level latency row, and this
    discrepancy is flagged explicitly in the final report.)
- §"Key load scenarios" (line ~981): 10,000 concurrent dashboard reads (no p95 degradation
  beyond 2x baseline), 1,000 concurrent attendance submissions (zero lost/duplicate writes).

## Reality check on scope (found during Phase 1 of this exercise)

The live dev server only has ONE seeded user (`admin@dev.local`, from
`packages/db/prisma/seed.ts`) — there is no `faculty@dev.local` / `student@dev.local` in
the actual seed script or DB, contrary to the task brief's assumption. `GET /exam-sessions`
returns 404 (not implemented/routed) on the running server. Scope below is therefore
limited to endpoints that actually exist and respond on the running instance, verified by
direct curl probes before writing any script:

| Endpoint | Verified response |
|---|---|
| POST /auth/login | 200/401 |
| GET /departments | 200 |
| GET /subjects | 200 |
| GET /rooms | 200 |
| GET /quizzes | 200 |
| GET /me/notifications | 200 |
| GET /users | 200 |
| GET /exam-sessions | 404 — NOT tested (not implemented) |
| POST /exam-sessions/{id}/attendance | not reachable without a real session — NOT tested |
| POST /reports/attendance, /report-jobs/{id} | not probed — out of scope for this pass |

This is a materially reduced scope vs. the task brief's full endpoint list. It is reported
honestly here rather than fabricated.

## Scenarios run

1. **auth-login-baseline**: `POST /auth/login` with the real admin credentials, low
   concurrency (5) below the 5/min-per-IP throttle window, single-connection-paced, to
   measure genuine auth latency. Success criterion: p95 < 500ms (general write target;
   ARCHITECTURE.md has no login-specific figure).
2. **auth-login-rate-limit-boundary**: deliberately exceed the 5 req/min/IP throttle on
   `/auth/login` to characterize 429 behavior (status code, body, Retry-After). Expected
   and correct to see 429s — not a bug.
3. **departments-list**: `GET /departments`, 20 concurrent connections, 10s duration —
   simulates admins/staff browsing academic structure. Target: p95 < 300ms (dashboard/read
   target).
4. **subjects-list**: same shape as above against `/subjects`.
5. **rooms-list**: same shape against `/rooms`.
6. **quizzes-list**: `GET /quizzes`, simulating faculty/student list-view traffic. Target:
   p95 < 300ms.
7. **notifications-list**: `GET /me/notifications`, simulating dashboard notification
   polling. Target: p95 < 300ms.

Concurrency of 20 is chosen deliberately conservative: all traffic originates from one
test-runner process on localhost, i.e. **one source IP**. The global `ThrottlerGuard`
(100 req/min/IP default) means anything above ~100 req/min aggregate across ALL these
list endpoints combined will start hitting 429s that have nothing to do with server
capacity — this is a genuine single-machine/per-IP testing limitation, not a finding about
the server's true multi-IP capacity. This is why list-endpoint scenarios are run at
low-moderate duration/rate (short bursts, not sustained saturation) — see report §5.

Seed data: `apps/api/load-tests/seed-load-test-data.ts` inserts departments/subjects
tagged with code prefix `LOAD_TEST_` via Prisma (not raw SQL, since no established raw-SQL
tagging convention from a prior "Phase 21" was found in this repo — no such migration/report
exists here; this is a new convention introduced by this phase). Cleanup script
`cleanup-load-test-data.ts` deletes everything with that prefix and verifies zero residue.
