import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  displayUnit,
  formatQty,
  UNITS,
  UNIT_CODES,
  unitType,
  type CategoryDto,
  type UnitCode,
  type UnitType,
} from '@kirana/shared';
import { Sheet } from './Sheet';
import { cn } from '../lib/utils';

const TYPE_LABELS: Readonly<Record<UnitType, string>> = {
  count: 'Count',
  weight: 'Weight',
  volume: 'Volume',
};

const UNIT_TYPES: readonly UnitType[] = ['count', 'weight', 'volume'];

export interface ItemDefaultsValues {
  readonly defaultCategoryId: string | null;
  readonly defaultUnitCode: UnitCode | null;
  readonly defaultQty: number | null;
}

interface ItemDefaultsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initial: ItemDefaultsValues;
  readonly categories: readonly CategoryDto[];
  readonly pending?: boolean;
  readonly onSubmit: (values: ItemDefaultsValues) => void;
}

export function ItemDefaultsSheet({
  open,
  onClose,
  initial,
  categories,
  pending = false,
  onSubmit,
}: ItemDefaultsSheetProps): React.JSX.Element {
  const [categoryId, setCategoryId] = useState<string | null>(initial.defaultCategoryId);
  const [qty, setQty] = useState<number | null>(initial.defaultQty);
  const [unit, setUnit] = useState<UnitCode | null>(initial.defaultUnitCode);

  useEffect(() => {
    if (open) {
      setCategoryId(initial.defaultCategoryId);
      setQty(initial.defaultQty);
      setUnit(initial.defaultUnitCode);
    }
  }, [open, initial]);

  const activeType: UnitType = unit !== null ? unitType(unit) : 'count';
  const typeUnits = UNIT_CODES.filter((code) => UNITS[code].type === activeType);
  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Sheet open={open} onClose={onClose} title="Edit defaults">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          onSubmit({ defaultCategoryId: categoryId, defaultUnitCode: unit, defaultQty: qty });
        }}
        className="flex flex-col gap-4"
      >
        <fieldset className="min-w-0">
          <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Category</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {sortedCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
                className={cn(
                  'min-h-11 rounded-pill border px-3 text-tab font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  categoryId === category.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                )}
              >
                <span aria-hidden="true">{category.icon ?? ''} </span>
                {category.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Quantity</legend>
          <div role="radiogroup" aria-label="Unit type" className="mt-1 flex gap-1">
            {UNIT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={activeType === type}
                onClick={() => setUnit(displayUnit(qty ?? 0, type))}
                className={cn(
                  'min-h-11 flex-1 rounded-chip border px-2 text-tab font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  activeType === type ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                )}
              >
                {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQty((current) => Math.max(1, (current ?? 1) - 1))}
              className="flex size-11 items-center justify-center rounded-chip border border-border hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Minus aria-hidden="true" className="size-4" />
            </button>
            <output aria-label="Quantity" className="min-w-12 text-center text-item font-semibold">
              {qty === null ? '—' : formatQty(qty)}
            </output>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQty((current) => (current === null ? 1 : current + 1))}
              className="flex size-11 items-center justify-center rounded-chip border border-border hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus aria-hidden="true" className="size-4" />
            </button>
            {qty !== null && (
              <button
                type="button"
                aria-label="Clear quantity"
                onClick={() => setQty(null)}
                className="flex size-11 items-center justify-center rounded-chip border border-border text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ✕
              </button>
            )}
            <label className="ml-auto">
              <span className="sr-only">Unit</span>
              <select
                value={unit ?? ''}
                onChange={(event) => setUnit(event.target.value === '' ? null : (event.target.value as UnitCode))}
                className="min-h-11 rounded-chip border border-border bg-bg px-2 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
              >
                <option value="">None</option>
                {typeUnits.map((code) => (
                  <option key={code} value={code}>
                    {UNITS[code].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
