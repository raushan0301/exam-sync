'use client';

import { useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, ChevronDown, ChevronRight, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { Drawer } from '@/components/ui/Drawer';
import { IconButton } from '@/components/ui/IconButton';
import { NotificationsBell } from '@/components/shell/NotificationsBell';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { useLogout } from '@/lib/mutations/useLogout';
import { useMarkNavSeen } from '@/lib/mutations/useMarkNavSeen';
import { useNavCounts } from '@/lib/queries/useNavCounts';
import { isNavGroup, type NavEntry, type NavLeaf } from '@/lib/navigation';

export interface AppShellProps {
  nav: NavEntry[];
  /** Admin: full persistent sidebar. Faculty: lighter/narrower sidebar. Student: no sidebar (top-bar only). */
  hasSidebar: boolean;
  sidebarStorageKey?: string;
  children: ReactNode;
}

/** Small red count pill; renders nothing for 0 / unknown so quiet items stay clean. */
function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${count} ${label}`}
      className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-text px-1 text-[10px] font-semibold leading-none text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function badgeLabel(item: NavLeaf): string {
  return item.seenKey ? `new in ${item.label}` : `waiting in ${item.label}`;
}

/**
 * Opening a "new since you looked" page clears its badge. Also fires when new
 * rows arrive while the page is already open, so the badge never lingers on
 * the page you are looking at.
 */
function useClearBadgeWhenOpen(item: NavLeaf, active: boolean, count: number) {
  const markSeen = useMarkNavSeen();
  const mutate = markSeen.mutate;
  useEffect(() => {
    if (active && item.seenKey && count > 0) mutate(item.seenKey);
  }, [active, item.seenKey, count, mutate]);
}

function NavLink({ item, onNavigate }: { item: NavLeaf; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = !!item.href && pathname?.startsWith(item.href);
  const { data: counts } = useNavCounts();
  const count = item.badgeKey ? (counts?.[item.badgeKey] ?? 0) : 0;
  useClearBadgeWhenOpen(item, active, count);

  if (!item.href) {
    return (
      <span
        className="flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm text-text-subtle opacity-60"
        aria-disabled="true"
        title="Not yet available"
      >
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-[44px] items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150 ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
        active ? 'bg-primary-50 font-medium text-primary-700' : 'text-text hover:bg-neutral-100',
      )}
    >
      {item.label}
      <CountBadge count={count} label={badgeLabel(item)} />
    </Link>
  );
}

function NavTree({ nav, onNavigate }: { nav: NavEntry[]; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-2">
      {nav.map((entry) =>
        isNavGroup(entry) ? (
          <NavGroupItem key={entry.label} entry={entry} onNavigate={onNavigate} />
        ) : (
          <NavLink key={entry.label} item={entry} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

function NavGroupItem({ entry, onNavigate }: { entry: { label: string; items: NavLeaf[] }; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: counts } = useNavCounts();
  const groupTotal = entry.items.reduce((sum, i) => sum + (i.badgeKey ? (counts?.[i.badgeKey] ?? 0) : 0), 0);
  const containsActive = entry.items.some((i) => i.href && pathname?.startsWith(i.href));
  const [open, setOpen] = useState(containsActive);
  // `containsActive` is recomputed every render from `pathname`, but the
  // `useState` initializer above only seeds `open` once, at mount — a
  // client-side navigation straight to a page inside this group (not via
  // clicking this toggle) would otherwise leave the group visually
  // collapsed while its own page is the active one. Re-sync whenever the
  // active-state crosses into this group; never force it closed once the
  // user has expanded/collapsed it by hand while already inside the group
  // (this only fires on the true/false transition, not every render).
  const wasActiveRef = useRef(containsActive);
  useEffect(() => {
    if (containsActive && !wasActiveRef.current) {
      setOpen(true);
    }
    wasActiveRef.current = containsActive;
  }, [containsActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-text hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        aria-expanded={open}
      >
        <span className="flex flex-1 items-center gap-2">
          {entry.label}
          {/* Children already show their own numbers when open; the total is for the closed group. */}
          {!open && <CountBadge count={groupTotal} label={`waiting in ${entry.label}`} />}
        </span>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className="ml-2 flex flex-col gap-0.5 border-l border-border pl-2">
          {entry.items.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({
  onMenuClick,
  showMenuButton,
  onToggleCollapse,
  collapsed,
  showCollapseButton,
}: {
  onMenuClick: () => void;
  showMenuButton: boolean;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  showCollapseButton?: boolean;
}) {
  const { user, primaryRole } = useIdentity();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="relative z-drawer flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-3 sm:px-4">
      <div className="flex items-center gap-2">
        {showMenuButton && (
          <IconButton
            icon={<Menu size={20} />}
            aria-label="Open navigation menu"
            onClick={onMenuClick}
            className="md:hidden"
          />
        )}
        {showCollapseButton && (
          <IconButton
            icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapse}
            className="hidden md:inline-flex"
          />
        )}
        <span className="text-sm font-semibold text-text">Exam-Sync</span>
      </div>

      <div className="flex items-center gap-2">
        <NotificationsBell primaryRole={primaryRole} />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex min-h-[44px] items-center gap-2 rounded-md px-2 py-1 text-sm text-text hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="max-w-[160px] truncate">{user?.email ?? '—'}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-dropdown mt-1 w-48 rounded-md border border-border bg-surface py-1 shadow-elevated"
            >
              <div className="border-b border-border px-3 py-2 text-xs text-text-muted">
                {primaryRole ?? 'Unknown role'}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => logout.mutate()}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-neutral-100"
              >
                <LogOut size={14} aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function BottomBarLink({ entry }: { entry: NavLeaf }) {
  const pathname = usePathname();
  const active = !!entry.href && pathname?.startsWith(entry.href);
  const { data: counts } = useNavCounts();
  const count = entry.badgeKey ? (counts?.[entry.badgeKey] ?? 0) : 0;
  useClearBadgeWhenOpen(entry, active, count);
  return (
    <Link
      href={entry.href ?? '#'}
      aria-disabled={!entry.href}
      className={cn(
        'flex min-h-[44px] flex-1 items-center justify-center gap-1 px-1 text-center text-xs',
        entry.href ? 'text-text' : 'pointer-events-none text-text-subtle opacity-60',
      )}
    >
      {entry.label}
      {count > 0 && (
        <span
          role="status"
          aria-label={`${count} ${badgeLabel(entry)}`}
          className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-text px-1 text-[10px] font-semibold leading-none text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 64;

export function AppShell({ nav, hasSidebar, sidebarStorageKey = 'exam_sync_sidebar_collapsed', children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!hasSidebar) return;
    try {
      const stored = window.localStorage.getItem(sidebarStorageKey);
      if (stored === 'true') setCollapsed(true);
    } catch {
      // localStorage unavailable — collapse state just won't persist.
    }
  }, [hasSidebar, sidebarStorageKey]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(next));
      } catch {
        // non-fatal
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        onMenuClick={() => setMobileOpen(true)}
        showMenuButton={hasSidebar}
        onToggleCollapse={toggleCollapsed}
        collapsed={collapsed}
        showCollapseButton={hasSidebar}
      />
      <div className="flex flex-1 overflow-hidden">
        {hasSidebar && (
          <aside
            className="hidden shrink-0 overflow-y-auto border-r border-border bg-surface py-3 transition-[width] duration-150 ease md:block"
            style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
          >
            {collapsed ? (
              <div className="px-2 text-center text-xs text-text-subtle">…</div>
            ) : (
              <NavTree nav={nav} />
            )}
          </aside>
        )}

        {hasSidebar && (
          <Drawer
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            title="Navigation"
            width={280}
          >
            <NavTree nav={nav} onNavigate={() => setMobileOpen(false)} />
          </Drawer>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>

      {!hasSidebar && (
        <nav
          aria-label="Primary"
          className="flex shrink-0 items-center justify-around border-t border-border bg-surface py-1 md:hidden"
        >
          {nav.map((entry) => (isNavGroup(entry) ? null : <BottomBarLink key={entry.label} entry={entry} />))}
        </nav>
      )}
    </div>
  );
}
