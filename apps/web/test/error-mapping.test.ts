import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/lib/api-client';
import { mapError } from '@/lib/error-mapping';

describe('mapError', () => {
  it('maps 401 to a session-expired auth kind', () => {
    const mapped = mapError(new ApiError(401, { message: 'Unauthorized' }));
    expect(mapped.kind).toBe('auth');
    expect(mapped.description).toMatch(/sign in again/i);
  });

  it('maps 403 to a forbidden kind with a permission message', () => {
    const mapped = mapError(new ApiError(403, { message: 'Forbidden' }));
    expect(mapped.kind).toBe('forbidden');
    expect(mapped.description).toMatch(/permission/i);
  });

  it('maps 404 to a neutral not-found message that reveals nothing about permissions', () => {
    const mapped = mapError(new ApiError(404, { message: 'Not Found' }));
    expect(mapped.kind).toBe('not-found');
    expect(mapped.description.toLowerCase()).not.toMatch(/permission|forbidden/);
  });

  it('preserves the details[] array on a 409 conflict', () => {
    const details = [{ field: 'code', reason: 'duplicate' }];
    const mapped = mapError(new ApiError(409, { message: 'Conflict', details }));
    expect(mapped.kind).toBe('conflict');
    expect(mapped.details).toEqual(details);
  });

  it('maps 422 to a validation kind and surfaces field details when present', () => {
    const details = [{ field: 'email', message: 'must be an email' }];
    const mapped = mapError(new ApiError(422, { message: 'Validation failed', details }));
    expect(mapped.kind).toBe('validation');
    expect(mapped.details).toEqual(details);
  });

  it('maps 423 to a locked kind including the reason when present', () => {
    const mapped = mapError(new ApiError(423, { message: 'Locked', reason: 'Exam in progress' }));
    expect(mapped.kind).toBe('locked');
    expect(mapped.description).toBe('Exam in progress');
  });

  it('maps 5xx to a generic server kind', () => {
    const mapped = mapError(new ApiError(500, { message: 'Internal error' }));
    expect(mapped.kind).toBe('server');
  });

  it('maps a NetworkError distinctly from a 5xx', () => {
    const mapped = mapError(new NetworkError());
    expect(mapped.kind).toBe('network');
    expect(mapped.description).toMatch(/connection/i);
  });
});
