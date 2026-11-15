import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/utils';

interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Minimal bottom sheet (§8.8): traps focus, closes on Escape and backdrop
 *  tap, restores focus to the trigger. vaul lands in P2 for drag gestures. */
export function Sheet({ open, onClose, title, children }: SheetProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || panel === null) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (firstEl === undefined || lastEl === undefined) return;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-card',
          'border-t border-border bg-surface p-4 pb-8 shadow-2xl',
        )}
      >
        <h2 className="text-store font-semibold">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
}: ConfirmSheetProps): React.JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-item">{message}</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            'min-h-11 flex-1 rounded-chip px-4 font-semibold',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            destructive
              ? 'bg-danger text-white hover:bg-danger/90'
              : 'bg-accent text-accent-fg hover:bg-accent/90',
          )}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 flex-1 rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
