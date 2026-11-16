import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useItems } from '../api/queries';
import { Sheet } from './Sheet';

const DEBOUNCE_MS = 80;

interface MergeItemSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The item being merged away (excluded from the target list). */
  readonly sourceId: string;
  readonly pending?: boolean;
  readonly onPick: (target: { readonly id: string; readonly name: string }) => void;
}

/** Target picker for §15.3 G3.5: search or browse the catalog, tap the item to
 * keep, then confirm on the next screen. */
export function MergeItemSheet({
  open,
  onClose,
  sourceId,
  pending = false,
  onPick,
}: MergeItemSheetProps): React.JSX.Element {
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(raw.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [raw]);

  const results = useItems({ q: debounced });
  const candidates =
    results.data?.pages
      .flatMap((page) => page.items)
      .filter((item) => item.id !== sourceId) ?? [];

  return (
    <Sheet open={open} onClose={onClose} title="Merge item">
      <p className="text-muted">Search for the item you want to keep.</p>
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

      <div className="mt-3">
        {results.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-chip bg-border/60" />
            ))}
          </div>
        ) : results.isError ? (
          <p role="alert" className="text-item text-danger">
            {results.error instanceof Error ? results.error.message : 'Could not load the catalog.'}
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-muted">No matches for &quot;{debounced}&quot;.</p>
        ) : (
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onPick({ id: candidate.id, name: candidate.name })}
                  className="flex min-h-11 w-full items-center gap-3 rounded-chip px-2 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:opacity-40"
                >
                  <span aria-hidden="true">{candidate.iconRef ?? '🛒'}</span>
                  <span className="min-w-0 flex-1 truncate text-item">{candidate.name}</span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
