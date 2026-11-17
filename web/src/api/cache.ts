import type {
  BoardResponse,
  ListItemDto,
  PatchListItemRequest,
  StoreDto,
  UnitCode,
  UpdateStoreRequest,
} from '@kirana/shared';
import { mergeAddIntoRow } from '@kirana/shared';

/** Recompute §6.6 counts from a store's items (active+bought only). */
export function recount(store: StoreDto): StoreDto {
  let bought = 0;
  for (const item of store.items) {
    if (item.status === 'bought') bought += 1;
  }
  return { ...store, counts: { total: store.items.length, bought } };
}

function mapStore(
  board: BoardResponse,
  storeId: string,
  fn: (store: StoreDto) => StoreDto,
): BoardResponse {
  return {
    ...board,
    stores: board.stores.map((store) => (store.id === storeId ? fn(store) : store)),
  };
}

export function findItem(
  board: BoardResponse | undefined,
  listItemId: string,
): { store: StoreDto; index: number } | undefined {
  if (board === undefined) return undefined;
  for (const store of board.stores) {
    const index = store.items.findIndex((item) => item.id === listItemId);
    if (index >= 0) return { store, index };
  }
  return undefined;
}

export function applyListItemPatch(
  board: BoardResponse,
  listItemId: string,
  patch: PatchListItemRequest,
): BoardResponse {
  const found = findItem(board, listItemId);
  if (found === undefined) return board;
  return mapStore(board, found.store.id, (store) =>
    recount({
      ...store,
      items: store.items.map((item, i) =>
        i === found.index
          ? {
              ...item,
              ...(patch.qtyValue !== undefined ? { qtyValue: patch.qtyValue } : {}),
              ...(patch.unitCode !== undefined ? { unitCode: patch.unitCode } : {}),
              ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
              ...(patch.note !== undefined ? { note: patch.note } : {}),
              ...(patch.status !== undefined ? { status: patch.status } : {}),
            }
          : item,
      ),
    }),
  );
}

export function applyBulkCheck(
  board: BoardResponse,
  ids: readonly string[],
  checked: boolean,
): BoardResponse {
  const idSet = new Set(ids);
  return {
    ...board,
    stores: board.stores.map((store) =>
      recount({
        ...store,
        items: store.items.map((item) =>
          idSet.has(item.id) ? { ...item, status: checked ? 'bought' : 'active' } : item,
        ),
      }),
    ),
  };
}

export function boughtIdsInStore(board: BoardResponse | undefined, storeId: string): string[] {
  if (board === undefined) return [];
  const store = board.stores.find((s) => s.id === storeId);
  if (store === undefined) return [];
  return store.items.filter((item) => item.status === 'bought').map((item) => item.id);
}

export function applyClearBought(board: BoardResponse, storeId: string): BoardResponse {
  return mapStore(board, storeId, (store) =>
    recount({ ...store, items: store.items.filter((item) => item.status !== 'bought') }),
  );
}

export function applyListItemDelete(board: BoardResponse, listItemId: string): BoardResponse {
  const found = findItem(board, listItemId);
  if (found === undefined) return board;
  return mapStore(board, found.store.id, (store) =>
    recount({ ...store, items: store.items.filter((item) => item.id !== listItemId) }),
  );
}

/** Optimistic append for the add-item sheet: a placeholder row keyed by the
 * clientId; the onSettled board refetch replaces it with the real row. */
export function applyListItemAdd(
  board: BoardResponse,
  storeId: string,
  optimistic: {
    clientId: string;
    itemId?: string;
    name: string;
    qtyValue: number | null;
    unitCode: UnitCode | null;
    categoryId: string | null;
    note?: string | null;
  },
): BoardResponse {
  return mapStore(board, storeId, (store) => {
    // ADR-0007: the server folds the add into the store's existing active
    // row for the item — mirror that optimistically so the view never
    // flashes a second row. Match by itemId when the sheet adds a picked
    // suggestion; by name otherwise (free-text adds that resolve to an
    // existing item).
    const index = store.items.findIndex(
      (item) =>
        item.status === 'active' &&
        (optimistic.itemId !== undefined
          ? item.itemId === optimistic.itemId
          : item.name.toLowerCase() === optimistic.name.trim().toLowerCase()),
    );
    if (index >= 0) {
      const existing = store.items[index];
      if (existing !== undefined) {
        const merged = mergeAddIntoRow(existing, {
          clientId: optimistic.clientId,
          qtyValue: optimistic.qtyValue ?? undefined,
          unitCode: optimistic.unitCode ?? undefined,
          categoryId: optimistic.categoryId ?? undefined,
          note: optimistic.note,
        });
        const items = [...store.items];
        items[index] = merged;
        return recount({ ...store, items });
      }
    }
    const placeholder: ListItemDto = {
      id: `pending:${optimistic.clientId}`,
      itemId: 'pending',
      name: optimistic.name,
      qtyValue: optimistic.qtyValue,
      unitCode: optimistic.unitCode,
      categoryId: optimistic.categoryId,
      status: 'active',
      note: null,
      addedBy: null,
      updatedAt: 0,
    };
    return recount({ ...store, items: [...store.items, placeholder] });
  });
}

export function applyStorePatch(
  board: BoardResponse,
  storeId: string,
  patch: UpdateStoreRequest,
): BoardResponse {
  return mapStore(board, storeId, (store) => ({
    ...store,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.iconKind !== undefined ? { iconKind: patch.iconKind } : {}),
    ...(patch.iconRef !== undefined ? { iconRef: patch.iconRef } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.categoryOrder !== undefined ? { categoryOrder: patch.categoryOrder } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
  }));
}

/** Optimistic reorder of the board's store list to match the committed
 *  order; every store's sortOrder is renumbered to match its position. */
export function applyStoreOrder(board: BoardResponse, orderedIds: readonly string[]): BoardResponse {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const reordered = [...board.stores].sort(
    (a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity),
  );
  return {
    ...board,
    stores: reordered.map((store, index) => ({
      ...store,
      sortOrder: position.get(store.id) === undefined ? store.sortOrder : index * 10,
    })),
  };
}

/** Optimistic category sortOrder renumber after a drag commit; the board's
 *  categories array keeps its shape (consumers sort by sortOrder). */
export function applyCategorySortOrder(
  board: BoardResponse,
  orderedIds: readonly string[],
): BoardResponse {
  const sortOrder = new Map(orderedIds.map((id, index) => [id, index * 10]));
  return {
    ...board,
    categories: board.categories.map((c) =>
      sortOrder.has(c.id) ? { ...c, sortOrder: sortOrder.get(c.id) ?? c.sortOrder } : c,
    ),
  };
}

export function applyStoreDelete(board: BoardResponse, storeId: string): BoardResponse {
  return { ...board, stores: board.stores.filter((store) => store.id !== storeId) };
}

export function applyStoreUpsert(board: BoardResponse, store: StoreDto): BoardResponse {
  const exists = board.stores.some((s) => s.id === store.id);
  return {
    ...board,
    stores: exists
      ? board.stores.map((s) => (s.id === store.id ? store : s))
      : [...board.stores, store],
  };
}
