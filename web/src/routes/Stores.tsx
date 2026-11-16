import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { MoreHorizontal } from 'lucide-react';
import type { StoreDto } from '@kirana/shared';
import {
  useBoard,
  useCreateStore,
  useDeleteStore,
  useReorderStores,
  useStoreAction,
  useUpdateStore,
} from '../api/queries';
import { ReorderList } from '../components/ReorderList';
import { ConfirmSheet } from '../components/Sheet';
import { MenuSheet } from '../components/MenuSheet';
import { StoreFormSheet, type StoreFormValues } from '../components/StoreFormSheet';

interface SheetState {
  readonly kind: 'add' | 'rename' | 'menu' | 'delete';
  readonly storeId?: string;
}

/** §6.6 counter copy, reused from the board; done/archived get status words. */
function storeMeta(store: StoreDto): string {
  if (store.status === 'done') return 'Done';
  if (store.status === 'archived') return 'Archived';
  const { total, bought } = store.counts;
  return bought === 0 ? (total === 0 ? 'Empty' : `${total} to buy`) : `${bought}/${total}`;
}

export function Stores(): React.JSX.Element {
  const navigate = useNavigate();
  const board = useBoard();
  const createStore = useCreateStore();
  const updateStore = useUpdateStore();
  const reopenStore = useStoreAction('reopen');
  const deleteStore = useDeleteStore();
  const reorderStores = useReorderStores();

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const onMutationError = useCallback((error: unknown): void => {
    setFormError(null);
    setBanner(error instanceof Error ? error.message : 'Something went wrong. Try again.');
  }, []);

  if (board.isPending) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Stores</h1>
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-card bg-border/60" />
          ))}
        </div>
      </div>
    );
  }

  if (board.isError || board.data === undefined) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Stores</h1>
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
  const byId = new Map(data.stores.map((store) => [store.id, store]));
  const managed = data.stores.filter((store) => store.status !== 'archived');
  const archived = data.stores.filter((store) => store.status === 'archived');

  const sheetStore = sheet?.storeId !== undefined ? byId.get(sheet.storeId) : undefined;

  const openMenu = (storeId: string): void => {
    setFormError(null);
    setSheet({ kind: 'menu', storeId });
  };

  const menuActions = (store: StoreDto) => [
    { label: 'Shop here', onSelect: () => navigate(`/store/${store.id}`) },
    {
      label: 'Rename…',
      onSelect: () => {
        setFormError(null);
        setSheet({ kind: 'rename', storeId: store.id });
      },
    },
    { label: 'Aisle order…', onSelect: () => navigate(`/categories?store=${store.id}`) },
    ...(store.status !== 'active'
      ? [{ label: 'Restore', onSelect: () => reopenStore.mutate(store.id, { onError: onMutationError }) }]
      : []),
    ...(store.status !== 'archived'
      ? [
          {
            label: 'Archive',
            disabled: store.counts.total - store.counts.bought > 0,
            onSelect: () =>
              updateStore.mutate(
                { id: store.id, patch: { status: 'archived' as const } },
                { onError: onMutationError },
              ),
          },
        ]
      : []),
    {
      label: 'Delete store…',
      destructive: true,
      onSelect: () => {
        setFormError(null);
        setSheet({ kind: 'delete', storeId: store.id });
      },
    },
  ];

  const rowContent = (id: string): React.JSX.Element | null => {
    const store = byId.get(id);
    if (store === undefined) return null;
    return (
      <div className="flex min-h-14 flex-1 items-center border-b border-border/60 pr-1">
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setSheet({ kind: 'rename', storeId: store.id });
          }}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-chip px-2 py-2 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <span aria-hidden="true" className="text-store">
            {store.iconRef ?? '🛒'}
          </span>
          <span className="min-w-0 flex-1 truncate text-item font-medium">{store.name}</span>
          <span className="shrink-0 text-tab text-muted">{storeMeta(store)}</span>
        </button>
        <button
          type="button"
          aria-label={`Store actions for ${store.name}`}
          onClick={() => openMenu(store.id)}
          className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>
    );
  };

  return (
    <div className="p-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <h1 className="text-store font-semibold">Stores</h1>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setSheet({ kind: 'add' });
          }}
          className="min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add store
        </button>
      </header>

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

      {data.stores.length === 0 ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-center">
          <p className="text-item">No stores yet. Add the places you shop.</p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setSheet({ kind: 'add' });
            }}
            className="mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Add your first store
          </button>
        </div>
      ) : (
        <>
          {managed.length > 0 ? (
            <ReorderList
              ids={managed.map((store) => store.id)}
              label={(id) => byId.get(id)?.name ?? 'store'}
              ariaLabel="Stores"
              onReorder={(ids) => reorderStores.mutate(ids, { onError: onMutationError })}
              renderItem={(id) => rowContent(id)}
            />
          ) : null}

          {archived.length > 0 && (
            <section className="mt-5" aria-label="Archived">
              <h2 className="px-3 text-tab font-semibold uppercase tracking-wide text-muted">
                Archived ({archived.length})
              </h2>
              <ul className="mt-1 flex flex-col">
                {archived.map((store) => (
                  <li key={store.id} className="flex items-stretch">
                    {rowContent(store.id)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <StoreFormSheet
        open={sheet?.kind === 'add'}
        onClose={() => setSheet(null)}
        title="Add store"
        submitLabel="Add store"
        pending={createStore.isPending}
        error={formError}
        onSubmit={(values: StoreFormValues) => {
          createStore.mutate(
            { name: values.name, iconKind: 'emoji', iconRef: values.iconRef },
            {
              onSuccess: () => {
                setSheet(null);
                setFormError(null);
              },
              onError: (error) => {
                setFormError(error instanceof Error ? error.message : 'Could not add the store.');
              },
            },
          );
        }}
      />

      <StoreFormSheet
        open={sheet?.kind === 'rename' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title="Rename store"
        submitLabel="Save"
        initial={
          sheetStore !== undefined ? { name: sheetStore.name, iconRef: sheetStore.iconRef } : undefined
        }
        pending={updateStore.isPending}
        error={formError}
        onSubmit={(values: StoreFormValues) => {
          if (sheet?.storeId === undefined) return;
          updateStore.mutate(
            {
              id: sheet.storeId,
              patch: { name: values.name, iconKind: 'emoji', iconRef: values.iconRef },
            },
            {
              onSuccess: () => {
                setSheet(null);
                setFormError(null);
              },
              onError: (error) => {
                setFormError(error instanceof Error ? error.message : 'Could not save the store.');
              },
            },
          );
        }}
      />

      <MenuSheet
        open={sheet?.kind === 'menu' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title={sheetStore?.name ?? 'Store'}
        actions={sheetStore !== undefined ? [...menuActions(sheetStore)] : []}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete' && sheetStore !== undefined}
        onClose={() => setSheet(null)}
        title="Delete store"
        message={`Remove ${sheetStore?.name ?? 'this store'}? Its history stays in backups.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (sheet?.storeId === undefined) return;
          deleteStore.mutate(sheet.storeId, {
            onSuccess: () => setSheet(null),
            // Close so the error banner (blocked copy) is not hidden behind
            // the overlay.
            onError: (error) => {
              setSheet(null);
              onMutationError(error);
            },
          });
        }}
      />
    </div>
  );
}
