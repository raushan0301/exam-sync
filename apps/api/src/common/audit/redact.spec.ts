import { redactSensitiveFields } from './redact';

describe('redactSensitiveFields', () => {
  it('redacts known sensitive fields at the top level', () => {
    const result = redactSensitiveFields({ id: 'u1', email: 'a@b.com', passwordHash: 'abc123' }) as Record<
      string,
      unknown
    >;
    expect(result.passwordHash).toBe('[REDACTED]');
    expect(result.email).toBe('a@b.com');
    expect(result.id).toBe('u1');
  });

  it('redacts sensitive fields nested inside an object', () => {
    const result = redactSensitiveFields({
      user: { id: 'u1', tokenHash: 'deadbeef' },
    }) as Record<string, unknown>;
    expect((result.user as Record<string, unknown>).tokenHash).toBe('[REDACTED]');
  });

  it('redacts sensitive fields inside array elements', () => {
    const result = redactSensitiveFields([{ passwordHash: 'x' }, { passwordHash: 'y' }]) as Record<
      string,
      unknown
    >[];
    expect(result[0].passwordHash).toBe('[REDACTED]');
    expect(result[1].passwordHash).toBe('[REDACTED]');
  });

  it('is case-insensitive on field names', () => {
    const result = redactSensitiveFields({ PasswordHash: 'x' }) as Record<string, unknown>;
    expect(result.PasswordHash).toBe('[REDACTED]');
  });

  it('passes through undefined and null unchanged', () => {
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields(null)).toBeNull();
  });

  it('leaves non-sensitive scalar and Date values untouched', () => {
    const date = new Date('2026-01-01');
    const result = redactSensitiveFields({ createdAt: date, count: 5 }) as Record<string, unknown>;
    expect(result.createdAt).toBe(date);
    expect(result.count).toBe(5);
  });

  it('passes a Prisma.Decimal instance through unchanged instead of walking its internal fields', () => {
    class FakeDecimal {
      constructor(
        public s: number,
        public e: number,
        public d: number[],
      ) {}
    }
    const decimal = new FakeDecimal(1, 2, [100]);
    const result = redactSensitiveFields({ totalMarks: decimal }) as Record<string, unknown>;
    expect(result.totalMarks).toBe(decimal);
    expect((result.totalMarks as FakeDecimal).s).toBe(1);
  });
});
