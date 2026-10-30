import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { setMockNavCounts, NAV_SEEN_CALLS, VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN } from './msw/handlers';
import { AppShell } from '@/components/shell/AppShell';
import { ADMIN_NAV, FACULTY_NAV, STUDENT_NAV } from '@/lib/navigation';

let mockPath = '/faculty/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function signIn() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

describe('sidebar count badges', () => {
  it('shows the red count beside a faculty item and nothing beside quiet ones', async () => {
    signIn();
    mockPath = '/faculty/dashboard';
    setMockNavCounts({ assignments: 2, 'invigilation-duties': 1, 'my-quizzes': 0 });

    renderWithProviders(<AppShell nav={FACULTY_NAV} hasSidebar>content</AppShell>);

    const assignments = await screen.findByRole('link', { name: /My Assignments/ });
    expect(await within(assignments).findByRole('status', { name: '2 new in My Assignments' })).toHaveTextContent('2');
    const duties = screen.getByRole('link', { name: /My Invigilation Duties/ });
    expect(within(duties).getByRole('status')).toHaveTextContent('1');
    expect(within(screen.getByRole('link', { name: /My Quizzes/ })).queryByRole('status')).toBeNull();
  });

  it('opening a "new" page tells the server it was seen and clears the badge', async () => {
    signIn();
    mockPath = '/faculty/assignments';
    setMockNavCounts({ assignments: 3 });

    renderWithProviders(<AppShell nav={FACULTY_NAV} hasSidebar>content</AppShell>);

    await waitFor(() => expect(NAV_SEEN_CALLS).toContain('assignments'));
    const link = screen.getByRole('link', { name: /My Assignments/ });
    await waitFor(() => expect(within(link).queryByRole('status')).toBeNull());
  });

  it('does not mark a "waiting on you" queue as seen just by opening it', async () => {
    signIn();
    mockPath = '/admin/quizzes/approval-queue';
    setMockNavCounts({ 'quizzes.approval': 4 });

    renderWithProviders(<AppShell nav={ADMIN_NAV} hasSidebar>content</AppShell>);

    const link = await screen.findByRole('link', { name: /Approval Queue/ });
    expect(await within(link).findByRole('status')).toHaveTextContent('4');
    expect(NAV_SEEN_CALLS).toEqual([]);
  });

  it('shows the total on a collapsed group and hides it once expanded', async () => {
    signIn();
    mockPath = '/admin/dashboard';
    setMockNavCounts({ 'quizzes.approval': 4 });

    renderWithProviders(<AppShell nav={ADMIN_NAV} hasSidebar>content</AppShell>);

    const group = await screen.findByRole('button', { name: /Quizzes/ });
    expect(await within(group).findByRole('status')).toHaveTextContent('4');
    await userEvent.click(group);
    expect(within(group).queryByRole('status')).toBeNull();
    expect(within(screen.getByRole('link', { name: /Approval Queue/ })).getByRole('status')).toHaveTextContent('4');
  });

  it('shows the unread count on the student bottom bar', async () => {
    signIn();
    mockPath = '/student/dashboard';
    setMockNavCounts({ notifications: 5 });

    renderWithProviders(<AppShell nav={STUDENT_NAV} hasSidebar={false}>content</AppShell>);

    const link = await screen.findByRole('link', { name: /Notifications/ });
    expect(await within(link).findByRole('status')).toHaveTextContent('5');
  });
});
