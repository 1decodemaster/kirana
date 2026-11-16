import { formatQty } from '@kirana/shared';
import type { ListItemDto } from '@kirana/shared';

/** "500 g" / "2 kg" / "1" — display only (§6.2 formats the number). */
export function qtyText(item: Pick<ListItemDto, 'qtyValue' | 'unitCode'>): string {
  if (item.qtyValue === null) return '';
  const qty = formatQty(item.qtyValue);
  return item.unitCode === null ? qty : `${qty} ${item.unitCode}`;
}

/** Accessible checkbox name per §8.8: "{name}, {qty}, {category}". */
export function itemAriaLabel(
  item: Pick<ListItemDto, 'name' | 'qtyValue' | 'unitCode'>,
  categoryName: string | undefined,
): string {
  const qty = qtyText(item);
  return [item.name, qty || undefined, categoryName].filter(Boolean).join(', ');
}

/** "2026-11-15" — UTC day of an epoch-ms timestamp (item-detail history). */
export function formatDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
