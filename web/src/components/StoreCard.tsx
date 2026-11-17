import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { CategoryDto, StoreDto } from '@kirana/shared';
import { ItemRow } from './ItemRow';
import { groupShopSections, type ShopSection } from '../lib/shopGroups';
import { cn } from '../lib/utils';

export interface StoreCardProps {
  readonly store: StoreDto;
  readonly categoriesById: ReadonlyMap<string, CategoryDto>;
  readonly expanded: boolean;
  readonly onToggleExpanded: (storeId: string) => void;
  readonly onToggleItem: (item: StoreDto['items'][number]) => void;
  readonly onItemMenu: (item: StoreDto['items'][number]) => void;
  readonly onClearBought: (storeId: string) => void;
  readonly onDone: (storeId: string) => void;
  readonly onArchive: (storeId: string) => void;
  readonly onStoreMenu: (storeId: string) => void;
  readonly pending?: boolean;
}

export function StoreCard({
  store,
  categoriesById,
  expanded,
  onToggleExpanded,
  onToggleItem,
  onItemMenu,
  onClearBought,
  onDone,
  onArchive,
  onStoreMenu,
  pending = false,
}: StoreCardProps): React.JSX.Element {
  const { total, bought } = store.counts;
  const active = total - bought;
  const fullyBought = total > 0 && active === 0;
  const percent = total === 0 ? 0 : Math.round((bought / total) * 100);

  return (
    <section
      aria-label={store.name}
      className={cn(
        'rounded-card border border-border bg-surface',
        pending && 'opacity-60',
      )}
    >
      <div className="flex items-center">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggleExpanded(store.id)}
            className="flex w-full items-center gap-2 rounded-t-card px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
            )}
            <span aria-hidden="true" className="text-store">
              {store.iconRef ?? '🛒'}
            </span>
            <span className="min-w-0 flex-1 truncate text-store font-semibold">{store.name}</span>
            <span className="shrink-0 pr-1 text-tab text-muted">
              {bought === 0 ? (total === 0 ? 'Empty' : `${total} to buy`) : `${bought}/${total}`}
            </span>
          </button>
        </h2>
        <button
          type="button"
          aria-label={`Store actions for ${store.name}`}
          onClick={() => onStoreMenu(store.id)}
          className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* §8.3: light progress bar next to the counter, never a donut. */}
      <div
        role="progressbar"
        aria-label={`${store.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mx-3 h-1 overflow-hidden rounded-pill bg-border"
      >
        <div
          className="h-full rounded-pill bg-accent transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>

      {expanded && (
        <div className="px-1 pb-2 pt-1">
          {store.items.length === 0 ? (
            <p className="px-3 py-4 text-muted">Nothing to buy here. Tap + to add an item.</p>
          ) : (
            groupShopSections(store.items, categoriesById).map((group: ShopSection, gi) => (
              <div key={group.category?.id ?? `none-${gi}`}>
                {group.category !== undefined && (
                  <h3
                    className="mt-2 flex items-center gap-2 border-l-4 px-3 py-1 text-tab font-semibold uppercase tracking-wide text-muted"
                    style={{ borderColor: group.category.color ?? 'transparent' }}
                  >
                    <span aria-hidden="true">{group.category.icon ?? ''}</span>
                    {group.category.name}
                  </h3>
                )}
                <ul>
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      categoryName={item.categoryId === null ? undefined : categoriesById.get(item.categoryId)?.name}
                      onToggle={onToggleItem}
                      onMenu={onItemMenu}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 px-2 pb-1 pt-2">
            {bought > 0 && (
              <button
                type="button"
                onClick={() => onClearBought(store.id)}
                className="min-h-11 rounded-chip border border-border px-3 text-item font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Clear bought ({bought})
              </button>
            )}
            {active === 0 && (
              <button
                type="button"
                onClick={() => onDone(store.id)}
                className="min-h-11 rounded-chip bg-accent px-3 text-item font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Done ✓
              </button>
            )}
            {fullyBought && store.status === 'active' && (
              <button
                type="button"
                onClick={() => onArchive(store.id)}
                className="min-h-11 rounded-chip px-2 text-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                All done! Archive this store?
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
