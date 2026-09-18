/**
 * Field-name denylist applied to every `oldValue`/`newValue` snapshot
 * before it is persisted to `audit_logs` or written to the structured log
 * line. Phase 20 authorization: "Do not expose sensitive information
 * through logs or audit records unless explicitly required."
 *
 * Deliberately a flat, case-insensitive name match rather than a per-model
 * schema (no model-aware redaction config exists anywhere else in this
 * codebase, and call sites pass whichever Prisma row shape they already
 * have — `Quiz`, `Room`, `User`, etc.) — matched against every prior-phase
 * model's actual sensitive columns (`User.passwordHash`,
 * `RefreshToken.tokenHash`). New sensitive fields must be added here
 * explicitly; this is intentionally NOT "redact anything that looks like
 * it might be sensitive" heuristics, which would risk silently redacting
 * legitimate audit data.
 */
const SENSITIVE_FIELD_NAMES = new Set(['passwordhash', 'tokenhash', 'password', 'refreshtoken', 'accesstoken']);

const REDACTED = '[REDACTED]';

export function redactSensitiveFields(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  // Prisma model fields can carry non-plain-object instances (e.g.
  // `Prisma.Decimal` for a numeric column such as `totalMarks`) that
  // expose their internal representation (`constructor`, `s`, `e`, `d`,
  // ...) as normal enumerable own properties. Recursing into those with
  // the plain-object branch below silently destroys the value: the
  // resulting `{ constructor: [Function], ... }` object then fails to
  // serialize when persisted to `audit_logs` ("could not serialize
  // [object Function] value"). Anything whose constructor isn't the
  // plain `Object` (a Prisma row snapshot's own nested `{...}` literals
  // always are) is passed through unchanged rather than walked.
  if (value.constructor !== Object) return value;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_FIELD_NAMES.has(key.toLowerCase()) ? REDACTED : redactSensitiveFields(val);
  }
  return result;
}
