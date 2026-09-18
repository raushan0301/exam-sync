import { LoginAttemptTrackerService } from './login-attempt-tracker.service';

describe('LoginAttemptTrackerService', () => {
  let tracker: LoginAttemptTrackerService;

  beforeEach(() => {
    tracker = new LoginAttemptTrackerService();
  });

  it('is not locked initially', () => {
    expect(tracker.isLocked('user@example.com')).toBe(false);
  });

  it('locks out after 5 consecutive failures', () => {
    for (let i = 0; i < 4; i++) {
      tracker.recordFailure('user@example.com');
      expect(tracker.isLocked('user@example.com')).toBe(false);
    }
    tracker.recordFailure('user@example.com');
    expect(tracker.isLocked('user@example.com')).toBe(true);
  });

  it('resets the counter on a recorded success', () => {
    for (let i = 0; i < 4; i++) tracker.recordFailure('user@example.com');
    tracker.recordSuccess('user@example.com');
    tracker.recordFailure('user@example.com');
    expect(tracker.isLocked('user@example.com')).toBe(false);
  });

  it('tracks lockout independently per email', () => {
    for (let i = 0; i < 5; i++) tracker.recordFailure('a@example.com');
    expect(tracker.isLocked('a@example.com')).toBe(true);
    expect(tracker.isLocked('b@example.com')).toBe(false);
  });

  it('is case-insensitive on email', () => {
    for (let i = 0; i < 5; i++) tracker.recordFailure('User@Example.com');
    expect(tracker.isLocked('user@example.com')).toBe(true);
  });
});
