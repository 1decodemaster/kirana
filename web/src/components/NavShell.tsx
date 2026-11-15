import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

interface Destination {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean;
}

const TABS: readonly Destination[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/catalog', label: 'Catalog' },
  { to: '/stores', label: 'Stores' },
];

const MORE_LINKS: readonly Destination[] = [
  { to: '/categories', label: 'Categories' },
  { to: '/data', label: 'Data' },
  { to: '/settings', label: 'Settings' },
];

const RAIL: readonly Destination[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/catalog', label: 'Catalog' },
  { to: '/stores', label: 'Stores' },
  { to: '/categories', label: 'Categories' },
  { to: '/data', label: 'Data' },
  { to: '/settings', label: 'Settings' },
];

const linkClass = (active: boolean): string =>
  [
    'flex min-h-11 items-center rounded-chip px-4 text-item',
    'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
    active ? 'bg-accent/10 font-semibold text-accent' : 'hover:bg-bg',
  ].join(' ');

const tabClass = (active: boolean): string =>
  [
    'flex min-h-11 min-w-11 flex-1 items-center justify-center text-tab',
    'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
    active ? 'font-semibold text-accent' : 'text-muted',
  ].join(' ');

export function NavShell(): React.JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const wasOpenRef = useRef(false);
  const location = useLocation();

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (moreOpen) {
      wasOpenRef.current = true;
      firstLinkRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [moreOpen]);

  return (
    <div className="min-h-dvh bg-bg font-sans text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-chip focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>

      <nav
        aria-label="Primary"
        className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-surface p-2 lg:flex"
      >
        <div className="px-3 py-3 text-store font-semibold">Kirana</div>
        {RAIL.map((d) => (
          <NavLink key={d.to} to={d.to} end={d.end} className={({ isActive }) => linkClass(isActive)}>
            {d.label}
          </NavLink>
        ))}
        <div className="mt-auto flex min-h-11 items-center gap-2 px-3">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-pill bg-accent/10 text-accent"
          >
            K
          </span>
          <span className="text-muted">Household</span>
        </div>
      </nav>

      <main id="main" className="pb-20 lg:pb-8 lg:pl-56">
        <Outlet />
      </main>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More"
            className="absolute inset-x-0 bottom-14 rounded-t-card border-t border-border bg-surface p-2 shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMoreOpen(false);
            }}
          >
            {MORE_LINKS.map((d, i) => (
              <NavLink
                key={d.to}
                to={d.to}
                ref={i === 0 ? firstLinkRef : undefined}
                className={({ isActive }) => linkClass(isActive)}
              >
                {d.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-surface lg:hidden"
      >
        {TABS.map((d) => (
          <NavLink key={d.to} to={d.to} end={d.end} className={({ isActive }) => tabClass(isActive)}>
            {d.label}
          </NavLink>
        ))}
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="flex min-h-11 min-w-11 flex-1 items-center justify-center text-tab text-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          More
        </button>
      </nav>
    </div>
  );
}
