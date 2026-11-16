import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

interface ItemRenameSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialName: string;
  readonly pending?: boolean;
  /** Inline error from the server (e.g. 409 CONFLICT_STALE). */
  readonly error?: string | null;
  readonly onSubmit: (name: string) => void;
}

export function ItemRenameSheet({
  open,
  onClose,
  initialName,
  pending = false,
  error = null,
  onSubmit,
}: ItemRenameSheetProps): React.JSX.Element {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <Sheet open={open} onClose={onClose} title="Rename item">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit(name.trim());
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-tab font-semibold uppercase tracking-wide text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
            enterKeyHint="done"
            className="min-h-11 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          />
        </label>

        {error !== null && (
          <p role="alert" className="text-item text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
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
