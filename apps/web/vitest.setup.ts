import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './test/msw/server';
import {
  setMockQuizzes,
  setMockIncidents,
  setMockNotifications,
  setMockDepartments,
  setMockPrograms,
  setMockBatches,
  setMockSubjects,
  setMockStudents,
  setMockFaculty,
  setMockNavCounts,
  setMockSharedHolds,
} from './test/msw/handlers';

// MSW server lifecycle — every test hits real HTTP endpoints (POST
// /auth/login, /auth/refresh, /auth/logout, GET /users/me) through MSW
// rather than mocking apiFetch itself.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // Auth tests store tokens in localStorage — without clearing it, a
  // successful login in one test leaks a "logged in" session into the
  // next test and breaks isolation (e.g. LoginPage redirecting away
  // before the next test can even find its form fields).
  window.localStorage.clear();
  // M3 dashboard fixtures are per-test state too — reset between tests.
  setMockQuizzes([]);
  setMockNavCounts({});
  setMockSharedHolds({});
  setMockIncidents([]);
  setMockNotifications([]);
  setMockDepartments([]);
  setMockPrograms([]);
  setMockBatches([]);
  setMockSubjects([]);
  setMockStudents([]);
  setMockFaculty([]);
});
afterAll(() => server.close());

// jsdom doesn't implement matchMedia — several ui components/hooks touch it indirectly.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
