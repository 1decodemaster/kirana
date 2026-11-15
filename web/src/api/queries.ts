import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardResponse,
  BulkCheckResponse,
  ClearBoughtResponse,
  CreateStoreRequest,
  DeletedResponse,
  ListItemMutationResponse,
  PatchListItemRequest,
  StoreMutationResponse,
  UpdateStoreRequest,
} from '@kirana/shared';
import { del, get, patch, post } from './client.js';
import {
  applyBulkCheck,
  applyClearBought,
  applyListItemDelete,
  applyListItemPatch,
  applyStoreDelete,
  applyStoreStatus,
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
      if (previous !== undefined && body.status !== undefined) {
        queryClient.setQueryData<BoardResponse>(
          BOARD_KEY,
          applyStoreStatus(previous, id, body.status),
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
          applyStoreStatus(previous, storeId, action === 'done' ? 'done' : 'active'),
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
