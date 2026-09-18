import { NotFoundException } from '@nestjs/common';
import { ScopedRepository } from './scoped-repository';
import { AuthenticatedUser } from '../auth/auth.types';

interface FakeNote {
  id: string;
  ownerId: string;
}

class FakeNoteRepository extends ScopedRepository<FakeNote> {
  private readonly store = new Map<string, FakeNote>([
    ['note-1', { id: 'note-1', ownerId: 'user-a' }],
  ]);

  protected async findByIdUnscoped(id: string): Promise<FakeNote | null> {
    return this.store.get(id) ?? null;
  }

  protected isOwnedByActor(entity: FakeNote, actor: AuthenticatedUser): boolean {
    return entity.ownerId === actor.id;
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes('ADMIN');
  }
}

function actor(id: string, roles: string[] = []): AuthenticatedUser {
  return { id, email: `${id}@example.com`, roles };
}

/**
 * Tests the resource-level authorization foundation itself (ADR-008),
 * independent of any real domain entity — Phase 1 has no domain resources
 * yet, but this base class is what every Phase 2+ module will build its own
 * scoped access on, so its own correctness matters now.
 */
describe('ScopedRepository (resource-level authorization foundation)', () => {
  let repo: FakeNoteRepository;

  beforeEach(() => {
    repo = new FakeNoteRepository();
  });

  it('returns the entity to its owner', async () => {
    const result = await repo.findScoped('note-1', actor('user-a'));
    expect(result.id).toBe('note-1');
  });

  it('returns the entity to an admin-bypass actor even if not the owner', async () => {
    const result = await repo.findScoped('note-1', actor('user-b', ['ADMIN']));
    expect(result.id).toBe('note-1');
  });

  it('throws 404 (not 403) for a non-owner, non-admin actor — IDOR-style access attempt', async () => {
    await expect(repo.findScoped('note-1', actor('user-b'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws the identical 404 for a non-existent id as for an unauthorized one', async () => {
    const missingError = await repo
      .findScoped('does-not-exist', actor('user-a'))
      .catch((e) => e);
    const unauthorizedError = await repo.findScoped('note-1', actor('user-b')).catch((e) => e);

    expect(missingError).toBeInstanceOf(NotFoundException);
    expect(unauthorizedError).toBeInstanceOf(NotFoundException);
    expect(missingError.getStatus()).toBe(unauthorizedError.getStatus());
    // Response bodies must be indistinguishable — this is what prevents an
    // attacker from telling "exists but not yours" apart from "doesn't exist".
    expect(missingError.getResponse()).toEqual(unauthorizedError.getResponse());
  });
});
