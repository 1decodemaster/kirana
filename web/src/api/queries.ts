import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddListItemRequest,
  AddListItemResponse,
  AliasMutationResponse,
  BoardResponse,
  BulkCheckResponse,
  CategoriesResponse,
  CategoryMutationResponse,
  ClearBoughtResponse,
  CreateAliasRequest,
  CreateCategoryRequest,
  CreateItemRequest,
  CreateStoreRequest,
  DeletedResponse,
  GetItemResponse,
  GetItemsResponse,
  ItemMutationResponse,
  ListItemMutationResponse,
  MergeItemsRequest,
  MergeItemsResponse,
  PatchListItemRequest,
  StoreMutationResponse,
  UpdateCategoryRequest,
  UpdateItemRequest,
  UpdateStoreRequest,
} from '@kirana/shared';
import { del, get, patch, post } from './client.js';
import {
  applyBulkCheck,
  applyCategorySortOrder,
  applyClearBought,
  applyListItemAdd,
  applyListItemDelete,
  applyListItemPatch,
  applyStoreDelete,
  applyStoreOrder,
  applyStorePatch,
  applyStoreUpsert,
  boughtIdsInStore,
} from './cache.js';

const BOARD_KEY = ['board'] as const;

export function useBoard(): ReturnType<typeof useQuery<BoardResponse>> {
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: ({ signal }) => get<BoardResponse>('/board', signal),
  });
}

export interface PatchListItemInput {
  readonly id: string;
  readonly patch: PatchListItemRequest;
}

export interface AddListItemInput {
  readonly storeId: string;
  readonly body: AddListItemRequest;
  /** Display name for the optimistic placeholder (the body may carry only an
   * itemId when the sheet adds a picked suggestion). */
  readonly displayName?: string;
}

export function useAddListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, body }: AddListItemInput) =>
      post<AddListItemResponse>(`/stores/${storeId}/items`, body),
    onMutate: async ({ storeId, body, displayName }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        // Optimistic placeholder row; the onSettled refetch swaps in the real one.
        queryClient.setQueryData<BoardResponse>(
          BOARD_KEY,
          applyListItemAdd(previous, storeId, {
            clientId: body.clientId,
            name: displayName ?? body.name ?? '',
            qtyValue: body.qtyValue ?? null,
            unitCode: body.unitCode ?? null,
            categoryId: body.categoryId ?? null,
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateItemRequest) => post<ItemMutationResponse>('/items', body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function usePatchListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch: body }: PatchListItemInput) =>
      patch<ListItemMutationResponse>(`/list-items/${id}`, body),
    onMutate: async ({ id, patch: body }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyListItemPatch(previous, id, body));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useBulkCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: readonly string[]; checked: boolean }) =>
      post<BulkCheckResponse>('/list-items/bulk-check', { ids: input.ids, checked: input.checked }),
    onMutate: async ({ ids, checked }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyBulkCheck(previous, ids, checked));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useClearBought() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string) =>
      post<ClearBoughtResponse>(`/stores/${storeId}/clear-bought`),
    onMutate: async (storeId) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      const undoIds = boughtIdsInStore(previous, storeId);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyClearBought(previous, storeId));
      }
      return { previous, undoIds };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useDeleteListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ undoToken: string }>(`/list-items/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyListItemDelete(previous, id));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoreRequest) =>
      post<StoreMutationResponse>('/stores', input).then((r) => r.store),
    onSuccess: (store) => {
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyStoreUpsert(previous, {
          ...store,
          items: [],
        }));
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useUpdateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateStoreRequest }) =>
      patch<StoreMutationResponse>(`/stores/${input.id}`, input.patch).then((r) => r.store),
    onMutate: async ({ id, patch: body }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyStorePatch(previous, id, body));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useStoreAction(action: 'done' | 'reopen') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string) =>
      post<StoreMutationResponse>(`/stores/${storeId}/${action}`).then((r) => r.store),
    onMutate: async (storeId) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(
          BOARD_KEY,
          applyStorePatch(previous, storeId, { status: action === 'done' ? 'done' : 'active' }),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useDeleteStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string) => del<DeletedResponse>(`/stores/${storeId}`),
    onMutate: async (storeId) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyStoreDelete(previous, storeId));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

// ─── Catalog (§8.1 /catalog, /catalog/:id; §7.2 #16–26) ────────────────────

export const ITEMS_PAGE_SIZE = 50;

export interface ItemsQueryInput {
  /** Empty string browses the whole catalog; otherwise ranked search. */
  readonly q: string;
}

/** GET /items — cursor-paginated browse or ranked search (§8.6). */
export function useItems(input: ItemsQueryInput) {
  return useInfiniteQuery({
    queryKey: ['items', input],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(ITEMS_PAGE_SIZE) });
      if (input.q !== '') params.set('q', input.q);
      if (pageParam !== '') params.set('cursor', pageParam);
      return get<GetItemsResponse>(`/items?${params.toString()}`, signal);
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: ({ signal }) => get<GetItemResponse>(`/items/${id}`, signal),
  });
}

export function usePatchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateItemRequest }) =>
      patch<ItemMutationResponse>(`/items/${input.id}`, input.patch).then((r) => r.item),
    onSettled: (_item, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['item', input.id] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<DeletedResponse>(`/items/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useCreateAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; body: CreateAliasRequest }) =>
      post<AliasMutationResponse>(`/items/${input.itemId}/aliases`, input.body).then((r) => r.alias),
    onSettled: (_alias, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['item', input.itemId] });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useDeleteAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; aliasId: string }) =>
      del<DeletedResponse>(`/items/${input.itemId}/aliases/${input.aliasId}`),
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['item', input.itemId] });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useMergeItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MergeItemsRequest) =>
      post<MergeItemsResponse>('/items/merge', input).then((r) => r.item),
    onSettled: (_item, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['item', input.sourceId] });
      void queryClient.invalidateQueries({ queryKey: ['item', input.targetId] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

// ─── Management (§8.1 /stores, /categories; §7.2 #6–8, #23–27) ──────────────

export const CATEGORIES_KEY = ['categories'] as const;

/** GET /categories — the management read with usage counts. */
export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: ({ signal }) => get<CategoriesResponse>('/categories', signal),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) =>
      post<CategoryMutationResponse>('/categories', body).then((r) => r.category),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateCategoryRequest }) =>
      patch<CategoryMutationResponse>(`/categories/${input.id}`, input.patch).then(
        (r) => r.category,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<DeletedResponse>(`/categories/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

/** Sequentially PATCH sortOrder for every store whose position changed
 *  (§7.2 #7 carries sortOrder); optimistic reorder keeps the list still. */
export function useReorderStores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: readonly string[]) => {
      for (const [index, id] of orderedIds.entries()) {
        await patch<StoreMutationResponse>(`/stores/${id}`, { sortOrder: index * 10 });
      }
    },
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(BOARD_KEY, applyStoreOrder(previous, orderedIds));
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

/** Sequentially PATCH sortOrder for every category whose position changed. */
export function useReorderCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly orderedIds: readonly string[];
      readonly changed: ReadonlySet<string>;
    }) => {
      for (const [index, id] of input.orderedIds.entries()) {
        if (!input.changed.has(id)) continue;
        await patch<CategoryMutationResponse>(`/categories/${id}`, { sortOrder: index * 10 });
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: CATEGORIES_KEY });
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previousCategories = queryClient.getQueryData<CategoriesResponse>(CATEGORIES_KEY);
      const previousBoard = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previousCategories !== undefined) {
        queryClient.setQueryData<CategoriesResponse>(CATEGORIES_KEY, {
          categories: previousCategories.categories.map((c) => {
            const index = input.orderedIds.indexOf(c.id);
            return index === -1 ? c : { ...c, sortOrder: index * 10 };
          }),
        });
      }
      if (previousBoard !== undefined) {
        queryClient.setQueryData<BoardResponse>(
          BOARD_KEY,
          applyCategorySortOrder(previousBoard, input.orderedIds),
        );
      }
      return { previousCategories, previousBoard };
    },
    onError: (_error, _input, context) => {
      if (context?.previousCategories !== undefined) {
        queryClient.setQueryData(CATEGORIES_KEY, context.previousCategories);
      }
      if (context?.previousBoard !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previousBoard);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

/** PATCH /stores/:id {categoryOrder} (§7.2 #7) — per-store aisle order. */
export function useSetAisleOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { storeId: string; categoryIds: readonly string[] }) =>
      patch<StoreMutationResponse>(`/stores/${input.storeId}`, {
        categoryOrder: input.categoryIds,
      }).then((r) => r.store),
    onMutate: async ({ storeId, categoryIds }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<BoardResponse>(
          BOARD_KEY,
          applyStorePatch(previous, storeId, { categoryOrder: [...categoryIds] }),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(BOARD_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}
