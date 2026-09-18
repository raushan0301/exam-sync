import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password to a value that is not the plaintext', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash).toEqual(expect.any(String));
  });

  it('produces an Argon2id hash (never plaintext, never reversible encryption)', async () => {
    const hash = await service.hash('some-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await service.hash('my-real-password');
    await expect(service.verify(hash, 'my-real-password')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('my-real-password');
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false (not throw) for a malformed hash', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });

  it('produces a different hash for the same password each time (random salt)', async () => {
    const hash1 = await service.hash('same-password');
    const hash2 = await service.hash('same-password');
    expect(hash1).not.toBe(hash2);
  });
});
