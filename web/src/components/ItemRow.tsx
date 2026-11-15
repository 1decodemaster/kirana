import { MoreHorizontal } from 'lucide-react';
import type { ListItemDto } from '@kirana/shared';
import { itemAriaLabel, qtyText } from '../lib/format';
import { cn } from '../lib/utils';

interface ItemRowProps {
  readonly item: ListItemDto;
  readonly categoryName: string | undefined;
  readonly onToggle: (item: ListItemDto) => void;
  readonly onMenu: (item: ListItemDto) => void;
}

/** §8.8: real checkbox button with aria-checked, icon + strikethrough for the
 *  checked state, 44px targets, visible focus. */
export function ItemRow({ item, categoryName, onToggle, onMenu }: ItemRowProps): React.JSX.Element {
  const bought = item.status === 'bought';
  return (
    <li className="flex items-center gap-1 pr-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={bought}
        aria-label={itemAriaLabel(item, categoryName)}
        onClick={() => onToggle(item)}
        className={cn(
          'flex min-h-11 flex-1 items-center gap-3 rounded-chip px-2 text-left',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
          'hover:bg-bg',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-chip border-2',
            bought ? 'border-bought bg-bought text-white' : 'border-muted/60',
          )}
        >
          {bought && (
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-item',
            bought && 'text-bought line-through',
          )}
        >
          {item.name}
        </span>
        <span className={cn('shrink-0 text-muted', bought && 'text-bought')}>{qtyText(item)}</span>
      </button>
      <button
        type="button"
        aria-label={`More actions for ${item.name}`}
        onClick={() => onMenu(item)}
        className="flex size-11 shrink-0 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
    </li>
  );
}
