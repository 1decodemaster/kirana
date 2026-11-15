import type { BoardResponse, PatchListItemRequest, StoreDto } from '@kirana/shared';

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

export function applyStoreStatus(
  board: BoardResponse,
  storeId: string,
  status: StoreDto['status'],
): BoardResponse {
  return mapStore(board, storeId, (store) => ({ ...store, status }));
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
