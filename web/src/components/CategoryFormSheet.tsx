import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { cn } from '../lib/utils';

/** §8.2 category palette — the same 6 muted colors the seeds use. */
export const CATEGORY_COLOR_PRESETS: readonly (string | null)[] = [
  '#94A3B8',
  '#A3B18A',
  '#D4A373',
  '#B5838D',
  '#8E9AAF',
  '#C9ADA7',
];

export const CATEGORY_EMOJI_PRESETS: readonly string[] = [
  '🥬', '🥛', '🍞', '🌾', '🌶️', '☕', '🧊', '🧹', '🧺', '🍳', '📦', '🔧',
];

export interface CategoryFormValues {
  readonly name: string;
  readonly icon: string | null;
  readonly color: string | null;
}

interface CategoryFormSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly initial?: CategoryFormValues;
  readonly pending?: boolean;
  /** Server error (e.g. name conflict) shown inline above the actions. */
  readonly error?: string | null;
  readonly onSubmit: (values: CategoryFormValues) => void;
}

export function CategoryFormSheet({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  pending = false,
  error = null,
  onSubmit,
}: CategoryFormSheetProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<string>(initial?.icon ?? '');
  const [color, setColor] = useState<string | null>(initial?.color ?? null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setIcon(initial?.icon ?? '');
      setColor(initial?.color ?? null);
    }
  }, [open, initial]);

  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ name: name.trim(), icon: icon === '' ? null : icon, color });
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-tab font-semibold uppercase tracking-wide text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            autoFocus
            enterKeyHint="done"
            className="min-h-11 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          />
        </label>

        <fieldset>
          <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Icon</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CATEGORY_EMOJI_PRESETS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={icon === emoji}
                onClick={() => setIcon(emoji)}
                className={cn(
                  'size-11 rounded-chip border text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  icon === emoji ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                )}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2">
            <span className="sr-only">Custom icon</span>
            <input
              type="text"
              value={icon}
              onChange={(event) => setIcon(event.target.value.slice(0, 8))}
              placeholder="Or type any emoji"
              maxLength={8}
              className="min-h-11 w-40 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Color</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CATEGORY_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={color === preset}
                aria-label={preset === null ? 'No color' : `Color ${preset}`}
                onClick={() => setColor(preset)}
                className={cn(
                  'size-11 rounded-chip border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  color === preset ? 'border-accent' : 'border-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className="mx-auto block size-6 rounded-pill border border-border"
                  style={preset === null ? undefined : { backgroundColor: preset }}
                >
                  {preset === null ? '∅' : ''}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {error !== null && (
          <p role="alert" className="rounded-chip border border-danger/40 bg-danger/10 px-3 py-2 text-item">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-11 flex-1 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {pending ? 'Saving…' : submitLabel}
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
