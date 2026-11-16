import { Sheet } from './Sheet';

export interface MenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

interface MenuSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly actions: readonly MenuAction[];
}

/** Action-list sheet for row/store menus (44px targets, focus-trapped). */
export function MenuSheet({ open, onClose, title, actions }: MenuSheetProps): React.JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="flex flex-col gap-1 pb-2">
        {actions.map((action) => (
          <li key={action.label}>
            <button
              type="button"
              disabled={action.disabled}
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={`min-h-11 w-full rounded-chip px-3 py-2 text-left text-item font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 ${
                action.destructive ? 'text-danger' : ''
              }`}
            >
              {action.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
