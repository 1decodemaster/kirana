import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { formatQty, UNITS } from '@kirana/shared';
import {
  useBoard,
  useCreateAlias,
  useDeleteAlias,
  useDeleteItem,
  useItem,
  useMergeItems,
  usePatchItem,
} from '../api/queries';
import { ApiError } from '../api/client';
import { AliasSheet, LANG_OPTIONS } from '../components/AliasSheet';
import { ItemDefaultsSheet } from '../components/ItemDefaultsSheet';
import { ItemRenameSheet } from '../components/ItemRenameSheet';
import { MergeItemSheet } from '../components/MergeItemSheet';
import { ConfirmSheet } from '../components/Sheet';
import { formatDay } from '../lib/format';

/** The §8.6 signals block of GET /items/:id (ADR-0003) — derived locally so
 * the contract file stays untouched. */
type ItemStats = import('@kirana/shared').GetItemResponse['stats'];

type SheetState =
  | { readonly kind: 'rename' }
  | { readonly kind: 'defaults' }
  | { readonly kind: 'add-alias' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'merge-confirm'; targetId: string; targetName: string }
  | { readonly kind: 'delete-item' }
  | { readonly kind: 'delete-alias'; aliasId: string; aliasText: string };

interface Suggestion {
  readonly id: string;
  readonly name: string;
}

function firstSuggestion(error: ApiError): Suggestion | null {
  const raw = error.details?.['suggestions'];
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  if (
    typeof first === 'object' &&
    first !== null &&
    typeof (first as { id?: unknown }).id === 'string' &&
    typeof (first as { name?: unknown }).name === 'string'
  ) {
    return { id: (first as { id: string }).id, name: (first as { name: string }).name };
  }
  return null;
}

function statsLine(stats: ItemStats): string {
  if (stats.timesAdded === 0) return 'Never added';
  const parts = [`Added ${stats.timesAdded} ${stats.timesAdded === 1 ? 'time' : 'times'}`];
  if (stats.lastAddedAt !== null) parts.push(`Last added ${formatDay(stats.lastAddedAt)}`);
  parts.push(`${stats.storeIds.length} ${stats.storeIds.length === 1 ? 'store' : 'stores'}`);
  return parts.join(' · ');
}

export function ItemDetail(): React.JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const itemId = id ?? '';

  const detail = useItem(itemId);
  const board = useBoard();
  const patchItem = usePatchItem();
  const deleteItem = useDeleteItem();
  const createAlias = useCreateAlias();
  const deleteAlias = useDeleteAlias();
  const mergeItems = useMergeItems();

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasSuggestion, setAliasSuggestion] = useState<Suggestion | null>(null);

  const onMutationError = (error: unknown): void => {
    setBanner(error instanceof Error ? error.message : 'Something went wrong. Try again.');
  };

  if (detail.isPending) {
    return (
      <div className="p-4">
        <div className="h-11 w-11 animate-pulse rounded-chip bg-border/60" aria-hidden="true" />
        <div className="mt-4 h-7 w-48 animate-pulse rounded-chip bg-border/60" aria-hidden="true" />
        <div className="mt-2 h-5 w-64 animate-pulse rounded-chip bg-border/60" aria-hidden="true" />
        <div className="mt-6 h-40 animate-pulse rounded-card bg-border/60" aria-hidden="true" />
        <div className="mt-4 h-32 animate-pulse rounded-card bg-border/60" aria-hidden="true" />
      </div>
    );
  }

  if (detail.isError || detail.data === undefined) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Item</h1>
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4">
          <p className="text-item">
            {notFound ? 'Item not found.' : detail.error instanceof Error ? detail.error.message : 'Could not load this item.'}
          </p>
          {!notFound && (
            <button
              type="button"
              onClick={() => void detail.refetch()}
              className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const item = detail.data.item;
  const stats = detail.data.stats;
  const categoriesById = new Map((board.data?.categories ?? []).map((c) => [c.id, c]));
  const defaultCategory = item.defaultCategoryId !== null ? categoriesById.get(item.defaultCategoryId) : undefined;
  const langLabel = (code: string): string =>
    LANG_OPTIONS.find((option) => option.code === code)?.label ?? code;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back to catalog"
          onClick={() => navigate('/catalog')}
          className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-store font-semibold">{item.name}</h1>
        <span aria-hidden="true" className="text-store">
          {item.iconRef ?? '🛒'}
        </span>
      </div>
      <p className="mt-1 text-muted">{statsLine(stats)}</p>

      {banner !== null && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2"
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

      <section aria-label="Defaults" className="mt-4 rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-item font-semibold">Defaults</h2>
          <button
            type="button"
            onClick={() => setSheet({ kind: 'defaults' })}
            className="flex min-h-11 items-center gap-1.5 rounded-chip px-3 text-item font-medium text-accent hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Pencil aria-hidden="true" className="size-4" />
            Edit
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-item">
          <dt className="text-muted">Category</dt>
          <dd className="truncate">{defaultCategory !== undefined ? defaultCategory.name : '—'}</dd>
          <dt className="text-muted">Unit</dt>
          <dd>{item.defaultUnitCode !== null ? UNITS[item.defaultUnitCode].label : '—'}</dd>
          <dt className="text-muted">Quantity</dt>
          <dd>{item.defaultQty !== null ? formatQty(item.defaultQty) : '—'}</dd>
        </dl>
      </section>

      <section aria-label="Aliases" className="mt-4 rounded-card border border-border bg-surface p-4">
        <h2 className="text-item font-semibold">Aliases</h2>
        {item.aliases.length > 0 && (
          <ul className="mt-2">
            {item.aliases.map((alias) => (
              <li key={alias.id} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-item">{alias.alias}</span>
                <span className="shrink-0 rounded-pill border border-border px-2 py-0.5 text-tab text-muted">
                  {langLabel(alias.lang)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove alias ${alias.alias}`}
                  onClick={() => setSheet({ kind: 'delete-alias', aliasId: alias.id, aliasText: alias.alias })}
                  className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            setAliasError(null);
            setAliasSuggestion(null);
            setSheet({ kind: 'add-alias' });
          }}
          className="mt-2 min-h-11 rounded-chip border border-border px-4 text-item font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add alias
        </button>
      </section>

      <section aria-label="Merge or delete" className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSheet({ kind: 'merge' })}
          className="min-h-11 rounded-card border border-border bg-surface px-4 text-left text-item font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Merge with another item…
        </button>
        <button
          type="button"
          onClick={() => setSheet({ kind: 'delete-item' })}
          className="min-h-11 rounded-card border border-border bg-surface px-4 text-left text-item font-medium text-danger hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Delete item…
        </button>
      </section>

      <ItemRenameSheet
        open={sheet?.kind === 'rename'}
        onClose={() => {
          setRenameError(null);
          setSheet(null);
        }}
        initialName={item.name}
        pending={patchItem.isPending}
        error={renameError}
        onSubmit={(name) => {
          setRenameError(null);
          patchItem.mutate(
            { id: itemId, patch: { name } },
            {
              onSuccess: () => setSheet(null),
              onError: (error) =>
                setRenameError(error instanceof Error ? error.message : 'Could not rename the item.'),
            },
          );
        }}
      />

      <ItemDefaultsSheet
        open={sheet?.kind === 'defaults'}
        onClose={() => setSheet(null)}
        initial={{
          defaultCategoryId: item.defaultCategoryId,
          defaultUnitCode: item.defaultUnitCode,
          defaultQty: item.defaultQty,
        }}
        categories={board.data?.categories ?? []}
        pending={patchItem.isPending}
        onSubmit={(values) => {
          patchItem.mutate(
            { id: itemId, patch: values },
            {
              onSuccess: () => setSheet(null),
              onError: onMutationError,
            },
          );
        }}
      />

      <AliasSheet
        open={sheet?.kind === 'add-alias'}
        onClose={() => {
          setAliasError(null);
          setAliasSuggestion(null);
          setSheet(null);
        }}
        pending={createAlias.isPending}
        error={aliasError}
        suggestionName={aliasSuggestion?.name ?? null}
        onOpenSuggestion={() => {
          if (aliasSuggestion === null) return;
          setSheet(null);
          navigate(`/catalog/${aliasSuggestion.id}`);
        }}
        onSubmit={(input) => {
          createAlias.mutate(
            { itemId, body: input },
            {
              onSuccess: () => setSheet(null),
              onError: (error) => {
                if (error instanceof ApiError) {
                  setAliasError(error.message);
                  setAliasSuggestion(firstSuggestion(error));
                } else {
                  setAliasError(error instanceof Error ? error.message : 'Could not add the alias.');
                  setAliasSuggestion(null);
                }
              },
            },
          );
        }}
      />

      <MergeItemSheet
        open={sheet?.kind === 'merge'}
        onClose={() => setSheet(null)}
        sourceId={itemId}
        pending={mergeItems.isPending}
        onPick={(target) => setSheet({ kind: 'merge-confirm', targetId: target.id, targetName: target.name })}
      />

      <ConfirmSheet
        open={sheet?.kind === 'merge-confirm'}
        onClose={() => setSheet(null)}
        title="Merge item"
        message={`Merge ${item.name} into ${sheet?.kind === 'merge-confirm' ? sheet.targetName : ''}? List entries, aliases and stats move to the item you keep. This cannot be undone.`}
        confirmLabel="Merge"
        destructive
        onConfirm={() => {
          if (sheet?.kind !== 'merge-confirm') return;
          const targetId = sheet.targetId;
          mergeItems.mutate(
            { sourceId: itemId, targetId },
            {
              onSuccess: () => navigate(`/catalog/${targetId}`, { replace: true }),
              onError: onMutationError,
            },
          );
        }}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete-item'}
        onClose={() => setSheet(null)}
        title="Delete item"
        message={`Delete ${item.name} from the catalog? Items on lists stay and show as "Archived item".`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteItem.mutate(itemId, {
            onSuccess: () => navigate('/catalog'),
            onError: onMutationError,
          });
        }}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete-alias'}
        onClose={() => setSheet(null)}
        title="Remove alias"
        message={`Remove alias "${sheet?.kind === 'delete-alias' ? sheet.aliasText : ''}"?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (sheet?.kind !== 'delete-alias') return;
          deleteAlias.mutate(
            { itemId, aliasId: sheet.aliasId },
            {
              onSuccess: () => setSheet(null),
              onError: onMutationError,
            },
          );
        }}
      />
    </div>
  );
}
