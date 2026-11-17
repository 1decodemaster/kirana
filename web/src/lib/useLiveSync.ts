import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent } from '@kirana/shared';

const BOARD_KEY = ['board'] as const;
const ITEMS_KEY = ['items'] as const;
const ITEM_KEY = ['item'] as const;
const CATEGORIES_KEY = ['categories'] as const;

/** §7.5 client behaviour: on a change event, refetch the affected slices.
 * The web client keeps a single board query, so list_item/store changes
 * invalidate it; catalog and category changes invalidate their keys too.
 * EventSource reconnects automatically and replays via Last-Event-ID. */
export function useLiveSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/v1/events');
    const onChange = (event: MessageEvent<string>): void => {
      let change: ChangeEvent;
      try {
        change = JSON.parse(event.data) as ChangeEvent;
      } catch {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
      if (change.entity === 'item' || change.entity === 'alias') {
        void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
        void queryClient.invalidateQueries({ queryKey: ITEM_KEY });
      }
      if (change.entity === 'category') {
        void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      }
    };
    source.addEventListener('change', onChange as EventListener);
    return () => {
      source.removeEventListener('change', onChange as EventListener);
      source.close();
    };
  }, [queryClient]);
}
