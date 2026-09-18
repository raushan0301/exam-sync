import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * ARCHITECTURE.md §AJ: "`request_id` (propagated from an `X-Request-Id`
 * header) ties a whole request's audit rows together for tracing" and §AP:
 * "structured JSON, correlated by `request_id`".
 *
 * `AsyncLocalStorage` is used instead of threading a `requestId` parameter
 * through every one of the ~40 `AuditHookService.record()` call sites
 * established since Phase 2 — those call sites already need editing this
 * phase to thread a `tx` parameter (BR-048), and adding a second new
 * parameter to every one of them for a cross-cutting concern like request
 * correlation would be a much larger, higher-risk diff for no behavioral
 * benefit ALS doesn't already give for free. This mirrors why NestJS's own
 * request-scoped providers exist, but ALS is used directly here (not a
 * request-scoped provider) because request-scoped providers force the
 * entire DI subtree that depends on them into per-request instantiation,
 * which `AuditHookService` — injected essentially everywhere — must not
 * become (it would silently break the `@Global()` singleton pattern every
 * other Phase 0-19 module already relies on).
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function getCurrentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
