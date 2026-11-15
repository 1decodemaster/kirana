import { useCallback, useReducer, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ListItemDto, StoreDto } from '@kirana/shared';
import {
  useBoard,
  useBulkCheck,
  useClearBought,
  useCreateStore,
  useDeleteListItem,
  useDeleteStore,
  usePatchListItem,
  useStoreAction,
  useUpdateStore,
} from '../api/queries';
import { StoreCard } from '../components/StoreCard';
import { ConfirmSheet } from '../components/Sheet';
import { MenuSheet } from '../components/MenuSheet';
import { StoreFormSheet, type StoreFormValues } from '../components/StoreFormSheet';
import { UndoToast } from '../components/UndoToast';

const EXPANDED_KEY = 'kirana.expanded-stores';
const ARCHIVED_OPEN_KEY = 'kirana.archived-open';

interface UndoState {
  readonly message: string;
  readonly undoIds: readonly string[];
}

interface SheetState {
  readonly kind: 'add-store' | 'rename-store' | 'item-menu' | 'store-menu' | 'delete-item' | 'delete-store';
  readonly storeId?: string;
  readonly itemId?: string;
}

type Banner = { readonly message: string } | null;

function readExpandedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function readArchivedOpen(): boolean {
  return localStorage.getItem(ARCHIVED_OPEN_KEY) === '1';
}

export function Home(): React.JSX.Element {
  const board = useBoard();
  const patchItem = usePatchListItem();
  const bulkCheck = useBulkCheck();
  const clearBought = useClearBought();
  const deleteListItem = useDeleteListItem();
  const createStore = useCreateStore();
  const updateStore = useUpdateStore();
  const doneStore = useStoreAction('done');
  const reopenStore = useStoreAction('reopen');
  const deleteStore = useDeleteStore();

  const [expandedMap, setExpandedMap] = useReducer(
    (map: Record<string, boolean>, action: { id: string; expanded: boolean }): Record<string, boolean> => {
      const next = { ...map, [action.id]: action.expanded };
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      return next;
    },
    undefined,
    readExpandedMap,
  );
  const [archivedOpen, setArchivedOpen] = useReducer(
    (_open: boolean, next: boolean): boolean => {
      localStorage.setItem(ARCHIVED_OPEN_KEY, next ? '1' : '0');
      return next;
    },
    undefined,
    readArchivedOpen,
  );

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const onMutationError = useCallback((error: unknown): void => {
    setBanner({
      message: error instanceof Error ? error.message : 'Something went wrong. Try again.',
    });
  }, []);

  if (board.isPending) {
    return (
      <div className="p-4">
        <SkeletonHeader />
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-card bg-border/60" />
          ))}
        </div>
      </div>
    );
  }

  if (board.isError || board.data === undefined) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Home</h1>
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

  const data = board.data;
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const activeStores = data.stores.filter((s) => s.status === 'active');
  const doneOrArchived = data.stores.filter((s) => s.status !== 'active');
  const emptyBoard = data.stores.length === 0;

  const isExpanded = (store: StoreDto): boolean => {
    const explicit = expandedMap[store.id];
    if (explicit !== undefined) return explicit;
    // §8.3: fully-bought stores auto-collapse; everything else starts open.
    const active = store.counts.total - store.counts.bought;
    return active > 0 || store.counts.total === 0;
  };

  const toggleItem = (item: ListItemDto): void => {
    patchItem.mutate(
      { id: item.id, patch: { status: item.status === 'bought' ? 'active' : 'bought' } },
      { onError: onMutationError },
    );
  };

  const toggleStore = (storeId: string): void => {
    const store = data.stores.find((s) => s.id === storeId);
    if (store === undefined) return;
    setExpandedMap({ id: storeId, expanded: !isExpanded(store) });
  };

  const sheetStore = sheet?.storeId !== undefined ? data.stores.find((s) => s.id === sheet.storeId) : undefined;
  const sheetItem =
    sheet?.itemId !== undefined
      ? data.stores.flatMap((s) => s.items).find((i) => i.id === sheet.itemId)
      : undefined;

  const archiveStore = (storeId: string): void => {
    updateStore.mutate({ id: storeId, patch: { status: 'archived' } }, { onError: onMutationError });
  };

  const storeMenuActions =
    sheetStore === undefined
      ? []
      : ([
          {
            label: 'Rename…',
            onSelect: () => setSheet({ kind: 'rename-store', storeId: sheetStore.id }),
          },
          ...(sheetStore.status !== 'active'
            ? [
                {
                  label: 'Restore',
                  onSelect: () => reopenStore.mutate(sheetStore.id, { onError: onMutationError }),
                },
              ]
            : []),
          ...(sheetStore.status !== 'archived'
            ? [
                {
                  label: 'Archive',
                  disabled: sheetStore.counts.total - sheetStore.counts.bought > 0,
                  onSelect: () => archiveStore(sheetStore.id),
                },
              ]
            : []),
          {
            label: 'Delete store…',
            destructive: true,
            onSelect: () => setSheet({ kind: 'delete-store', storeId: sheetStore.id }),
          },
        ] as const);

  return (
    <div className="p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-store font-semibold">Home</h1>
        <ul className="flex -space-x-1.5" aria-label={`${data.household.name} members`}>
          {data.members.map((member) => (
            <li key={member.id}>
              <span
                title={member.displayName}
                className="flex size-8 items-center justify-center rounded-pill border-2 border-surface text-tab font-semibold text-white"
                style={{ backgroundColor: member.color }}
              >
                {member.displayName.charAt(0).toUpperCase()}
                <span className="sr-only">{member.displayName}</span>
              </span>
            </li>
          ))}
        </ul>
      </header>

      {banner !== null && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2"
        >
          <p className="flex-1 text-item">{banner.message}</p>
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

      {emptyBoard ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-center">
          <p className="text-item">No stores yet. Add the places you shop.</p>
          <button
            type="button"
            onClick={() => setSheet({ kind: 'add-store' })}
            className="mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Add your first store
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3">
            {activeStores.map((store) => (
              <StoreCard
                key={store.id}
                store={store}
                categoriesById={categoriesById}
                expanded={isExpanded(store)}
                onToggleExpanded={toggleStore}
                onToggleItem={toggleItem}
                onItemMenu={(item) => setSheet({ kind: 'item-menu', itemId: item.id })}
                onClearBought={(storeId) =>
                  clearBought.mutate(storeId, {
                    onSuccess: (result, _storeId, context) => {
                      if (result.cleared > 0) {
                        setUndo({
                          message: `Cleared ${result.cleared} items`,
                          undoIds: context?.undoIds ?? [],
                        });
                      }
                    },
                    onError: onMutationError,
                  })
                }
                onDone={(storeId) => doneStore.mutate(storeId, { onError: onMutationError })}
                onArchive={(storeId) => doneStore.mutate(storeId, { onError: onMutationError })}
                onStoreMenu={(storeId) => setSheet({ kind: 'store-menu', storeId })}
                pending={doneStore.isPending && doneStore.variables === store.id}
              />
            ))}
          </div>

          {doneOrArchived.length > 0 && (
            <section className="mt-4" aria-label="Archived">
              <button
                type="button"
                aria-expanded={archivedOpen}
                onClick={() => setArchivedOpen(!archivedOpen)}
                className="flex min-h-11 w-full items-center justify-between rounded-chip px-3 text-store font-semibold text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              >
                <span>Archived ({doneOrArchived.length})</span>
                <span aria-hidden="true">{archivedOpen ? '▾' : '▸'}</span>
              </button>
              {archivedOpen && (
                <div className="mt-2 flex flex-col gap-3">
                  {doneOrArchived.map((store) => (
                    <StoreCard
                      key={store.id}
                      store={store}
                      categoriesById={categoriesById}
                      expanded={false}
                      onToggleExpanded={toggleStore}
                      onToggleItem={toggleItem}
                      onItemMenu={(item) => setSheet({ kind: 'item-menu', itemId: item.id })}
                      onClearBought={(storeId) =>
                        clearBought.mutate(storeId, { onError: onMutationError })
                      }
                      onDone={(storeId) => doneStore.mutate(storeId, { onError: onMutationError })}
                      onArchive={(storeId) => doneStore.mutate(storeId, { onError: onMutationError })}
                      onStoreMenu={(storeId) => setSheet({ kind: 'store-menu', storeId })}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <button
        type="button"
        aria-label="Add store"
        onClick={() => setSheet({ kind: 'add-store' })}
        className="fixed bottom-20 right-4 z-30 flex size-14 items-center justify-center rounded-pill bg-accent text-accent-fg shadow-lg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:bottom-8 lg:left-64 lg:right-auto"
      >
        <Plus aria-hidden="true" className="size-7" />
      </button>

      <StoreFormSheet
        open={sheet?.kind === 'add-store'}
        onClose={() => setSheet(null)}
        title="Add store"
        submitLabel="Add store"
        pending={createStore.isPending}
        onSubmit={(values: StoreFormValues) => {
          createStore.mutate(
            { name: values.name, iconKind: 'emoji', iconRef: values.iconRef },
            {
              onSuccess: () => setSheet(null),
              onError: onMutationError,
            },
          );
        }}
      />

      <StoreFormSheet
        open={sheet?.kind === 'rename-store' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title="Rename store"
        submitLabel="Save"
        initial={
          sheetStore !== undefined ? { name: sheetStore.name, iconRef: sheetStore.iconRef } : undefined
        }
        pending={updateStore.isPending}
        onSubmit={(values: StoreFormValues) => {
          if (sheet?.storeId === undefined) return;
          updateStore.mutate(
            {
              id: sheet.storeId,
              patch: { name: values.name, iconKind: 'emoji', iconRef: values.iconRef },
            },
            { onSuccess: () => setSheet(null), onError: onMutationError },
          );
        }}
      />

      <MenuSheet
        open={sheet?.kind === 'item-menu' && sheetItem !== undefined}
        onClose={() => setSheet(null)}
        title={sheetItem?.name ?? 'Item'}
        actions={[
          {
            label: 'Remove from list…',
            destructive: true,
            onSelect: () => setSheet({ kind: 'delete-item', itemId: sheet?.itemId }),
          },
        ]}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete-item' && sheetItem !== undefined}
        onClose={() => setSheet(null)}
        title="Remove item"
        message={`Remove ${sheetItem?.name ?? 'this item'} from this list?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (sheet?.itemId === undefined) return;
          deleteListItem.mutate(sheet.itemId, {
            onSuccess: () => setSheet(null),
            onError: onMutationError,
          });
        }}
      />

      <MenuSheet
        open={sheet?.kind === 'store-menu' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title={sheetStore?.name ?? 'Store'}
        actions={[...storeMenuActions]}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete-store' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title="Delete store"
        message={`Remove ${sheetStore?.name ?? 'this store'}? Its history stays in backups.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (sheet?.storeId === undefined) return;
          deleteStore.mutate(sheet.storeId, {
            onSuccess: () => setSheet(null),
            onError: onMutationError,
          });
        }}
      />

      {undo !== null && (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            bulkCheck.mutate(
              { ids: undo.undoIds, checked: true },
              { onError: onMutationError },
            );
            setUndo(null);
          }}
          onExpire={() => setUndo(null)}
        />
      )}
    </div>
  );
}

function SkeletonHeader(): React.JSX.Element {
  return (
    <div className="flex items-center justify-between" aria-hidden="true">
      <div className="h-6 w-24 animate-pulse rounded-chip bg-border/60" />
      <div className="h-8 w-16 animate-pulse rounded-pill bg-border/60" />
    </div>
  );
}
