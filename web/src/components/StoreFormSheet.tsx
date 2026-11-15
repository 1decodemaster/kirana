import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { cn } from '../lib/utils';

export const STORE_EMOJI_PRESETS: readonly string[] = [
  '🏬', '🛒', '🏪', '🧺', '🌿', '🥬', '🍞', '🥛', '💊', '🧰', '🛠️', '📦',
];

export interface StoreFormValues {
  readonly name: string;
  readonly iconRef: string | null;
}

interface StoreFormSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly initial?: StoreFormValues;
  readonly pending?: boolean;
  readonly onSubmit: (values: StoreFormValues) => void;
}

export function StoreFormSheet({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  pending = false,
  onSubmit,
}: StoreFormSheetProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<string>(initial?.iconRef ?? '');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setIcon(initial?.iconRef ?? '');
    }
  }, [open, initial]);

  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ name: name.trim(), iconRef: icon === '' ? null : icon });
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
            {STORE_EMOJI_PRESETS.map((emoji) => (
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
