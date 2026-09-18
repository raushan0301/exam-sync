import { Prisma } from '@exam-sync/db';
import { PrismaService } from './prisma.service';

const MAX_ATTEMPTS = 3;

/**
 * Runs `fn` inside a `SERIALIZABLE` transaction, retrying on Prisma's
 * `P2034` ("Transaction failed due to a write conflict or a deadlock.
 * Please retry your transaction") — the documented, EXPECTED outcome of
 * two concurrently-conflicting `SERIALIZABLE` transactions, not a bug
 * (docs/adr/003-concurrency-and-booking-races.md, Implementation Notes:
 * "SERIALIZABLE transactions must implement retry-on-serialization-failure
 * ... at the service layer"). Scoped narrowly — callers should wrap only
 * the specific check-then-act sequence that needs it (ADR-003 Trade-offs:
 * "must be scoped to the minimum necessary statement(s), not wrapped
 * around entire request handlers"), not every mutation in a service.
 *
 * A domain exception thrown inside `fn` (e.g. `ConflictException` for a
 * genuine hard conflict found by the Conflict Engine) is NOT retried —
 * only Prisma's own write-conflict error is. Postgres transparently maps
 * its `40001 serialization_failure` to Prisma's `P2034`, so callers never
 * need to know the underlying error code.
 */
export async function runSerializable<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      lastError = err;
      const isRetryableWriteConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (!isRetryableWriteConflict || attempt >= MAX_ATTEMPTS) {
        throw err;
      }
    }
  }
  throw lastError;
}
