import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MoreHorizontal } from 'lucide-react';
import type { CategoryDto } from '@kirana/shared';
import {
  useBoard,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useReorderCategories,
  useSetAisleOrder,
  useUpdateCategory,
} from '../api/queries';
import { ReorderList } from '../components/ReorderList';
import { ConfirmSheet } from '../components/Sheet';
import { MenuSheet } from '../components/MenuSheet';
import { CategoryFormSheet, type CategoryFormValues } from '../components/CategoryFormSheet';
import { effectiveAisleOrder, moveTo } from '../lib/reorder';
import { cn } from '../lib/utils';

interface SheetState {
  readonly kind: 'add' | 'edit' | 'menu' | 'delete';
  readonly categoryId?: string;
}

/** The §6.5 fallback row — the server refuses to delete it. */
function isOtherFallback(category: CategoryDto): boolean {
  return category.name === 'Other' && category.scope === 'grocery';
}

function itemCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

export function Categories(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const board = useBoard();
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategories = useReorderCategories();
  const setAisleOrder = useSetAisleOrder();

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const onMutationError = useCallback((error: unknown): void => {
    setFormError(null);
    setBanner(error instanceof Error ? error.message : 'Something went wrong. Try again.');
  }, []);

  if (categories.isPending || board.isPending) {
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Categories</h1>
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-card bg-border/60" />
          ))}
        </div>
      </div>
    );
  }

  if (categories.isError || categories.data === undefined || board.isError || board.data === undefined) {
    const error = categories.error ?? board.error;
    return (
      <div className="p-4">
        <h1 className="text-store font-semibold">Categories</h1>
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4">
          <p className="text-item">
            {error instanceof Error ? error.message : 'Could not load categories.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void categories.refetch();
              void board.refetch();
            }}
            className="mt-3 min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const data = categories.data.categories;
  const byId = new Map(data.map((category) => [category.id, category]));
  const listIds = data.map((category) => category.id);

  const aisleStores = board.data.stores.filter((store) => store.status !== 'archived');
  const storeParam = searchParams.get('store');
  const selectedStore =
    aisleStores.find((store) => store.id === storeParam) ?? aisleStores[0] ?? undefined;

  const sheetCategory = sheet?.categoryId !== undefined ? byId.get(sheet.categoryId) : undefined;

  const openMenu = (categoryId: string): void => {
    setFormError(null);
    setSheet({ kind: 'menu', categoryId });
  };

  const commitCategoryOrder = (orderedIds: readonly string[]): void => {
    const changed = new Set(
      orderedIds.filter((id, index) => byId.get(id)?.sortOrder !== index * 10),
    );
    reorderCategories.mutate({ orderedIds, changed }, { onError: onMutationError });
  };

  const moveCategory = (id: string, delta: -1 | 1): void => {
    const index = listIds.indexOf(id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= listIds.length) return;
    commitCategoryOrder(moveTo(listIds, index, target));
  };

  const menuActions = (category: CategoryDto) => {
    const index = listIds.indexOf(category.id);
    return [
      {
        label: 'Edit…',
        onSelect: () => {
          setFormError(null);
          setSheet({ kind: 'edit', categoryId: category.id });
        },
      },
      { label: 'Move up', disabled: index <= 0, onSelect: () => moveCategory(category.id, -1) },
      {
        label: 'Move down',
        disabled: index === -1 || index >= listIds.length - 1,
        onSelect: () => moveCategory(category.id, 1),
      },
      ...(isOtherFallback(category)
        ? []
        : [
            {
              label: 'Delete…',
              destructive: true,
              onSelect: () => {
                setFormError(null);
                setSheet({ kind: 'delete', categoryId: category.id });
              },
            },
          ]),
    ];
  };

  const rowContent = (id: string): React.JSX.Element | null => {
    const category = byId.get(id);
    if (category === undefined) return null;
    return (
      <div className="flex min-h-14 flex-1 items-center border-b border-border/60 pr-1">
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setSheet({ kind: 'edit', categoryId: category.id });
          }}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-chip py-2 pl-2 pr-1 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <span
            aria-hidden="true"
            className={cn('w-1 self-stretch rounded-pill', category.color === null && 'bg-transparent')}
            style={category.color !== null ? { backgroundColor: category.color } : undefined}
          />
          <span aria-hidden="true" className="text-item">
            {category.icon ?? ''}
          </span>
          <span className="min-w-0 flex-1 truncate text-item font-medium">{category.name}</span>
          <span className="shrink-0 text-tab text-muted">{itemCountLabel(category.itemCount)}</span>
        </button>
        <button
          type="button"
          aria-label={`Category actions for ${category.name}`}
          onClick={() => openMenu(category.id)}
          className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>
    );
  };

  const aisleRow = (id: string): React.JSX.Element | null => {
    const category = byId.get(id);
    if (category === undefined) return null;
    return (
      <div className="flex min-h-12 flex-1 items-center gap-2 border-b border-border/60 px-2">
        <span aria-hidden="true" className="text-item">
          {category.icon ?? ''}
        </span>
        <span className="min-w-0 flex-1 truncate text-item">{category.name}</span>
      </div>
    );
  };

  return (
    <div className="p-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <h1 className="text-store font-semibold">Categories</h1>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setSheet({ kind: 'add' });
          }}
          className="min-h-11 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add category
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

      {data.length === 0 ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-center">
          <p className="text-item">No categories yet. Add the aisles you shop by.</p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setSheet({ kind: 'add' });
            }}
            className="mt-4 min-h-11 w-full rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Add category
          </button>
        </div>
      ) : (
        <>
          <ReorderList
            ids={listIds}
            label={(id) => byId.get(id)?.name ?? 'category'}
            ariaLabel="Categories"
            onReorder={commitCategoryOrder}
            renderItem={(id) => rowContent(id)}
          />

          {selectedStore !== undefined && (
            <section className="mt-6" aria-label="Aisle order">
              <h2 className="px-3 text-tab font-semibold uppercase tracking-wide text-muted">
                Aisle order
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {aisleStores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    aria-pressed={store.id === selectedStore.id}
                    onClick={() => setSearchParams({ store: store.id })}
                    className={cn(
                      'min-h-11 rounded-pill border px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      store.id === selectedStore.id
                        ? 'border-accent bg-accent/10 font-semibold text-accent'
                        : 'border-border hover:bg-bg',
                    )}
                  >
                    <span aria-hidden="true">{store.iconRef ?? '🛒'} </span>
                    {store.name}
                  </button>
                ))}
              </div>
              <p className="mt-2 px-3 text-tab text-muted">
                Drag to set how {selectedStore.name} groups its aisles.
              </p>
              <div className="mt-2">
                <ReorderList
                  ids={effectiveAisleOrder(selectedStore.categoryOrder, data)}
                  label={(id) => byId.get(id)?.name ?? 'category'}
                  ariaLabel="Aisle order"
                  onReorder={(ids) =>
                    setAisleOrder.mutate(
                      { storeId: selectedStore.id, categoryIds: ids },
                      { onError: onMutationError },
                    )
                  }
                  renderItem={(id) => aisleRow(id)}
                />
              </div>
            </section>
          )}
        </>
      )}

      <CategoryFormSheet
        open={sheet?.kind === 'add'}
        onClose={() => setSheet(null)}
        title="Add category"
        submitLabel="Add category"
        pending={createCategory.isPending}
        error={formError}
        onSubmit={(values: CategoryFormValues) => {
          createCategory.mutate(
            { name: values.name, scope: 'grocery', icon: values.icon ?? undefined, color: values.color ?? undefined },
            {
              onSuccess: () => {
                setSheet(null);
                setFormError(null);
              },
              onError: (error) => {
                setFormError(
                  error instanceof Error ? error.message : 'Could not add the category.',
                );
              },
            },
          );
        }}
      />

      <CategoryFormSheet
        open={sheet?.kind === 'edit' && sheetCategory !== undefined}
        onClose={() => setSheet(null)}
        title="Edit category"
        submitLabel="Save"
        initial={
          sheetCategory !== undefined
            ? { name: sheetCategory.name, icon: sheetCategory.icon, color: sheetCategory.color }
            : undefined
        }
        pending={updateCategory.isPending}
        error={formError}
        onSubmit={(values: CategoryFormValues) => {
          if (sheet?.categoryId === undefined) return;
          updateCategory.mutate(
            {
              id: sheet.categoryId,
              patch: {
                name: values.name,
                icon: values.icon,
                color: values.color,
              },
            },
            {
              onSuccess: () => {
                setSheet(null);
                setFormError(null);
              },
              onError: (error) => {
                setFormError(
                  error instanceof Error ? error.message : 'Could not save the category.',
                );
              },
            },
          );
        }}
      />

      <MenuSheet
        open={sheet?.kind === 'menu' && sheetCategory !== undefined}
        onClose={() => setSheet(null)}
        title={sheetCategory?.name ?? 'Category'}
        actions={sheetCategory !== undefined ? [...menuActions(sheetCategory)] : []}
      />

      <ConfirmSheet
        open={sheet?.kind === 'delete' && sheetCategory !== undefined}
        onClose={() => setSheet(null)}
        title="Delete category"
        message={`Delete ${sheetCategory?.name ?? 'this category'}? Items in it move to Other.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (sheet?.categoryId === undefined) return;
          deleteCategory.mutate(sheet.categoryId, {
            onSuccess: () => setSheet(null),
            // Close so the error banner is not hidden behind the overlay.
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
