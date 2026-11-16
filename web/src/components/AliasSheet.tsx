import { useEffect, useState } from 'react';
import type { AliasInput } from '@kirana/shared';
import { Sheet } from './Sheet';
import { cn } from '../lib/utils';

export const LANG_OPTIONS: ReadonlyArray<{ readonly code: AliasInput['lang']; readonly label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi-Latn', label: 'Hindi (Latin)' },
  { code: 'hi', label: 'Hindi (Devanagari)' },
];

interface AliasSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pending?: boolean;
  /** Inline error from the server (e.g. 409 ITEM_NEAR_DUPLICATE). */
  readonly error?: string | null;
  /** Name of the colliding item, when the error carries one. */
  readonly suggestionName?: string | null;
  readonly onOpenSuggestion?: (name: string) => void;
  readonly onSubmit: (input: AliasInput) => void;
}

export function AliasSheet({
  open,
  onClose,
  pending = false,
  error = null,
  suggestionName = null,
  onOpenSuggestion,
  onSubmit,
}: AliasSheetProps): React.JSX.Element {
  const [alias, setAlias] = useState('');
  const [lang, setLang] = useState<AliasInput['lang']>('en');

  useEffect(() => {
    if (open) {
      setAlias('');
      setLang('en');
    }
  }, [open]);

  const canSubmit = alias.trim().length > 0 && !pending;

  return (
    <Sheet open={open} onClose={onClose} title="Add alias">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ alias: alias.trim(), lang });
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-tab font-semibold uppercase tracking-wide text-muted">Alias</span>
          <input
            type="text"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            maxLength={80}
            required
            autoFocus
            enterKeyHint="done"
            placeholder="pyaaz, प्याज़…"
            className="min-h-11 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          />
        </label>

        <fieldset>
          <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Language</legend>
          <div role="radiogroup" aria-label="Language" className="mt-1 flex gap-1">
            {LANG_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={lang === option.code}
                onClick={() => setLang(option.code)}
                className={cn(
                  'min-h-11 flex-1 rounded-chip border px-2 text-tab font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  lang === option.code ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {error !== null && (
          <div role="alert" className="rounded-card border border-border bg-bg p-3">
            <p className="text-item">{error}</p>
            {suggestionName !== null && onOpenSuggestion !== undefined && (
              <button
                type="button"
                onClick={() => onOpenSuggestion(suggestionName)}
                className="mt-2 min-h-11 w-full rounded-chip bg-accent px-3 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Go to {suggestionName}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-11 flex-1 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Add alias'}
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
