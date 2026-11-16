import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { UNITS } from '@kirana/shared';
import { useBoard, useItems } from '../api/queries';
import { groupCatalogResults, type CatalogGroup } from '../lib/catalogGroups';

const DEBOUNCE_MS = 80;

export function Catalog(): React.JSX.Element {
  const navigate = useNavigate();
  const board = useBoard();
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');

  // §8.4: 80 ms debounce on the name field.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(raw.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [raw]);

  const searching = debounced !== '';
  const items = useItems({ q: debounced });
  const categories = board.data?.categories ?? [];

  const flat = useMemo(
    () => items.data?.pages.flatMap((page) => page.items) ?? [],
    [items.data],
  );
  const groups = useMemo(
    () => (searching ? [] : groupCatalogResults(flat, categories)),
    [searching, flat, categories],
  );

  if (board.isPending || items.isPending) {
    return (
      <div className="p-4">
        <div className="h-6 w-28 animate-pulse rounded-chip bg-border/60" aria-hidden="true" />
        <div className="mt-4 h-11 animate-pulse rounded-chip bg-border/60" aria-hidden="true" />
        <div className="mt-4 flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-chip bg-border/60" />
          ))}
        </div>
      </div>
    );
  }

  if (items.isError) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Catalog</h1>
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4">
          <p className="text-item">
            {items.error instanceof Error ? items.error.message : 'Could not load the catalog.'}
          </p>
          <button
            type="button"
            onClick={() => void items.refetch()}
            className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-store font-semibold">Catalog</h1>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-tab font-semibold uppercase tracking-wide text-muted">Search</span>
        <input
          type="text"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          aria-label="Search catalog"
          placeholder="Search catalog"
          className="min-h-11 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
        />
      </label>

      {flat.length === 0 ? (
        searching ? (
          <p className="mt-6 text-item text-muted">No matches for &quot;{debounced}&quot;.</p>
        ) : (
          <div className="mt-6 rounded-card border border-border bg-surface p-6 text-center">
            <p className="text-item">No catalog items yet. Add items from any store list.</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Go to Home
            </button>
          </div>
        )
      ) : searching ? (
        <ul className="mt-3">
          {flat.map((item) => (
            <CatalogRow key={item.id} itemId={item.id} name={item.name} iconRef={item.iconRef} unitCode={item.defaultUnit} />
          ))}
        </ul>
      ) : (
        groups.map((group) => <CatalogGroupSection key={group.categoryId ?? 'none'} group={group} />)
      )}

      {items.hasNextPage && (
        <button
          type="button"
          onClick={() => void items.fetchNextPage()}
          disabled={items.isFetchingNextPage}
          className="mt-4 min-h-11 w-full rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function CatalogGroupSection({ group }: { readonly group: CatalogGroup }): React.JSX.Element {
  return (
    <section aria-label={group.name}>
      <h2
        className="mt-4 border-l-4 px-3 py-1 text-tab font-semibold uppercase tracking-wide text-muted"
        style={group.color !== null ? { borderLeftColor: group.color } : undefined}
      >
        <span aria-hidden="true">{group.icon ?? ''}</span> {group.name}
      </h2>
      <ul>
        {group.items.map((item) => (
          <CatalogRow
            key={item.id}
            itemId={item.id}
            name={item.name}
            iconRef={item.iconRef}
            unitCode={item.defaultUnit}
          />
        ))}
      </ul>
    </section>
  );
}

interface CatalogRowProps {
  readonly itemId: string;
  readonly name: string;
  readonly iconRef: string | null;
  readonly unitCode: keyof typeof UNITS | null;
}

function CatalogRow({ itemId, name, iconRef, unitCode }: CatalogRowProps): React.JSX.Element {
  return (
    <li>
      <Link
        to={`/catalog/${itemId}`}
        className="flex min-h-11 w-full items-center gap-3 rounded-chip px-2 hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <span aria-hidden="true">{iconRef ?? '🛒'}</span>
        <span className="min-w-0 flex-1 truncate text-item">{name}</span>
        {unitCode !== null && <span className="text-tab text-muted">{UNITS[unitCode].label}</span>}
        <ChevronRight aria-hidden="true" className="size-4 text-muted" />
      </Link>
    </li>
  );
}
