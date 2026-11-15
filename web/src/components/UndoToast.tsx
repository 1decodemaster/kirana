import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';

interface UndoToastProps {
  readonly message: string;
  readonly onUndo: () => void;
  /** Seconds the toast stays visible (5s per §6.7). */
  readonly durationMs?: number;
  readonly onExpire: () => void;
}

export function UndoToast({
  message,
  onUndo,
  durationMs = 5_000,
  onExpire,
}: UndoToastProps): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
    const leavingTimer = window.setTimeout(() => setLeaving(true), durationMs - 150);
    const expireTimer = window.setTimeout(onExpire, durationMs);
    return () => {
      window.clearTimeout(leavingTimer);
      window.clearTimeout(expireTimer);
    };
  }, [durationMs, onExpire]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-4 bottom-20 z-40 flex items-center gap-3 rounded-card bg-fg px-4 py-3 text-bg shadow-lg transition-opacity duration-150 lg:bottom-8 lg:left-64 lg:right-auto lg:min-w-80 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <span className="flex-1 text-item font-medium">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex min-h-11 items-center gap-1.5 rounded-chip px-3 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <Undo2 aria-hidden="true" className="size-4" />
        Undo
      </button>
    </div>
  );
}
