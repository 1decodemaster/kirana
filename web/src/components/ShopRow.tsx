import type { ListItemDto } from '@kirana/shared';
import { itemAriaLabel, qtyText } from '../lib/format';
import { cn } from '../lib/utils';

interface ShopRowProps {
  readonly item: ListItemDto;
  readonly categoryName: string | undefined;
  readonly onToggle: (item: ListItemDto) => void;
}

/** §8.5 Shop Mode row: 56px tall, 28px visual checkbox, qty chip
 * right-aligned. The whole row is the checkbox target (≥44px, §8.8) with the
 * §8.8 accessible name "{item name}, {qty}, {category}". */
export function ShopRow({ item, categoryName, onToggle }: ShopRowProps): React.JSX.Element {
  const bought = item.status === 'bought';
  const qty = qtyText(item);
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={bought}
        aria-label={itemAriaLabel(item, categoryName)}
        onClick={() => onToggle(item)}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-chip px-3 text-left',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
          'hover:bg-bg',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-chip border-2',
            bought ? 'border-bought bg-bought text-white' : 'border-muted/60',
          )}
        >
          {bought && (
            <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5">
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
        {qty !== '' && (
          <span
            className={cn(
              'shrink-0 rounded-pill bg-border px-2.5 py-0.5 text-tab tabular-nums',
              bought && 'text-bought',
            )}
          >
            {qty}
          </span>
        )}
      </button>
    </li>
  );
}
