import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { X } from 'lucide-react';
import type { ListItemDto } from '@kirana/shared';
import { useBoard, usePatchListItem, useStoreAction } from '../api/queries';
import { firstUncheckedIndex, groupShopSections, sectionCounts } from '../lib/shopGroups';
import { animateScrollTo } from '../lib/scroll';
import { cn } from '../lib/utils';
import { ShopRow } from '../components/ShopRow';

const sectionId = (index: number): string => `shop-section-${index}`;

const mutationMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';

/** §8.5: single store, full screen, no tab bar — the in-store view. A pure
 * view over the same board cache Home uses; zero new endpoints or tables. */
export function ShopMode(): React.JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const board = useBoard();
  const patchItem = usePatchListItem();
  const doneStore = useStoreAction('done');
  const [banner, setBanner] = useState<string | null>(null);

  const store = useMemo(() => board.data?.stores.find((s) => s.id === id), [board.data, id]);
  const categoriesById = useMemo(
    () => new Map((board.data?.categories ?? []).map((c) => [c.id, c])),
    [board.data],
  );
  const sections = useMemo(
    () => (store === undefined ? [] : groupShopSections(store.items, categoriesById)),
    [store, categoriesById],
  );
  const currentIdx = useMemo(() => firstUncheckedIndex(sections), [sections]);
  const allChecked =
    store !== undefined && store.counts.total > 0 && store.counts.total === store.counts.bought;

  const exitToHome = useCallback((): void => {
    // G15.4: navigate back when Home sits behind us so its scroll position
    // restores (ScrollRestoration); deep links fall back to a fresh Home.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }, [navigate]);

  // Escape mirrors the ✕ exit (§8.8 keyboard operation).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') exitToHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitToHome]);

  // §8.5 optional: keep the screen awake while shopping. Progressive
  // enhancement — unsupported or denied wake lock changes nothing else.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    const acquire = (): void => {
      navigator.wakeLock
        ?.request('screen')
        .then((s) => {
          sentinel = s;
        })
        .catch(() => {
          sentinel = null;
        });
    };
    const release = (): void => {
      sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
    const onVisibility = (): void => {
      // The platform auto-releases on hide; re-acquire when the shopper returns.
      if (document.visibilityState === 'visible' && sentinel === null) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, []);

  // §8.5/G15.1: completing the current category auto-expands the next
  // unchecked one — scroll it into view with the 200 ms animation.
  const cancelScrollRef = useRef<(() => void) | null>(null);
  const prevIdxRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prev = prevIdxRef.current;
    prevIdxRef.current = currentIdx;
    if (prev === undefined || currentIdx === undefined || prev === currentIdx) return;
    const el = document.getElementById(sectionId(currentIdx));
    if (el === null) return;
    const header = document.getElementById('shop-header');
    const offset = (header?.offsetHeight ?? 0) + 8;
    const target = el.getBoundingClientRect().top + window.scrollY - offset;
    cancelScrollRef.current?.();
    cancelScrollRef.current = animateScrollTo(target, 200);
    return () => {
      cancelScrollRef.current?.();
      cancelScrollRef.current = null;
    };
  }, [currentIdx]);

  const toggleItem = useCallback(
    (item: ListItemDto): void => {
      patchItem.mutate(
        { id: item.id, patch: { status: item.status === 'bought' ? 'active' : 'bought' } },
        { onError: (error) => setBanner(mutationMessage(error)) },
      );
    },
    [patchItem],
  );

  const onDoneShopping = (): void => {
    if (store === undefined) return;
    doneStore.mutate(store.id, {
      onSuccess: () => exitToHome(),
      onError: (error) => setBanner(mutationMessage(error)),
    });
  };

  if (board.isPending) {
    return <ShopSkeleton />;
  }

  if (board.isError || board.data === undefined) {
    return (
      <div className="min-h-dvh bg-bg p-4">
        <h1 className="text-store font-semibold">Shop Mode</h1>
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4">
          <p className="text-item">
            {board.error instanceof Error ? board.error.message : 'Could not load the board.'}
          </p>
          <button
            type="button"
            onClick={() => void board.refetch()}
            className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (store === undefined || store.items.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-bg p-6 text-center">
        <p className="text-item">{store === undefined ? 'Store not found.' : 'Nothing to buy here.'}</p>
        <button
          type="button"
          onClick={exitToHome}
          className="mt-4 min-h-11 w-full max-w-64 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const { total, bought } = store.counts;
  const percent = total === 0 ? 0 : Math.round((bought / total) * 100);

  return (
    <div className="min-h-dvh bg-bg pb-24">
      <header
        id="shop-header"
        className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <span aria-hidden="true" className="text-store">
            {store.iconRef ?? '🛒'}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-store font-semibold">{store.name}</h1>
          <span className="shrink-0 text-tab tabular-nums text-muted">
            {bought}/{total}
          </span>
          <button
            type="button"
            aria-label="Exit shop mode"
            onClick={exitToHome}
            className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <X aria-hidden="true" className="size-6" />
          </button>
        </div>
        {/* §8.3-style light progress bar; checked state never color-only (§8.8). */}
        <div
          role="progressbar"
          aria-label={`${store.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mx-3 mb-2 h-1 overflow-hidden rounded-pill bg-border"
        >
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      {banner !== null && (
        <div
          role="alert"
          className="mx-3 mt-3 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2"
        >
          <p className="flex-1 text-item">{banner}</p>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss message"
            className="flex size-11 items-center justify-center rounded-chip text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>
      )}

      <div className="px-1 pt-2">
        {sections.map((section, i) => {
          const counts = sectionCounts(section);
          const isCurrent = i === currentIdx;
          return (
            <section
              key={section.categoryId ?? `none-${i}`}
              id={sectionId(i)}
              aria-label={section.category?.name ?? 'Other items'}
              className="mb-2"
            >
              <h2
                className="flex items-center gap-2 px-3 py-2 text-tab font-semibold uppercase tracking-wide text-muted"
                style={section.category?.color != null ? { color: section.category.color } : undefined}
              >
                <span aria-hidden="true">{section.category?.icon ?? ''}</span>
                <span className="min-w-0 flex-1 truncate">
                  {section.category?.name ?? 'Other items'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {counts.bought}/{counts.total}
                </span>
              </h2>
              {isCurrent && (
                <ul>
                  {section.items.map((item) => (
                    <ShopRow
                      key={item.id}
                      item={item}
                      categoryName={section.category?.name}
                      onToggle={toggleItem}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-3">
        <button
          type="button"
          disabled={!allChecked}
          onClick={onDoneShopping}
          className={cn(
            'min-h-14 w-full rounded-chip bg-accent px-4 text-item font-semibold text-accent-fg',
            'hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          Done shopping
        </button>
      </footer>
    </div>
  );
}

/** §8.7: the skeleton matches the final layout — header, progress, and
 * section headers with 56px rows. */
function ShopSkeleton(): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="sticky top-0 border-b border-border bg-surface px-3 pb-2 pt-3">
        <div className="flex items-center gap-2" aria-hidden="true">
          <div className="h-7 w-7 animate-pulse rounded-chip bg-border/60" />
          <div className="h-6 w-40 animate-pulse rounded-chip bg-border/60" />
          <div className="ml-auto h-5 w-10 animate-pulse rounded-chip bg-border/60" />
        </div>
        <div className="mt-2 h-1 animate-pulse rounded-pill bg-border/60" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-4 px-4 pt-4" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-5 w-28 animate-pulse rounded-chip bg-border/60" />
            <div className="mt-2 h-14 animate-pulse rounded-card bg-border/40" />
            <div className="mt-1 h-14 animate-pulse rounded-card bg-border/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
