import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { insertionIndex, moveTo } from '../lib/reorder';
import { cn } from '../lib/utils';

interface ReorderListProps {
  /** Row ids in display order; re-syncs whenever the content changes. */
  readonly ids: readonly string[];
  /** Human name for announcements and the handle's accessible label. */
  readonly label: (id: string) => string;
  readonly ariaLabel: string;
  /** Called with the committed order on drop (pointer or keyboard). */
  readonly onReorder: (ids: readonly string[]) => void;
  readonly renderItem: (id: string, dragging: boolean) => ReactNode;
}

interface DragState {
  readonly id: string;
  readonly dy: number;
  readonly keyboard: boolean;
}

interface DragRef {
  readonly id: string;
  readonly pointerId: number;
  readonly startY: number;
  /** Midpoints of the other rows, in DOM order, measured at grab time. */
  readonly others: readonly number[];
  readonly minDy: number;
  readonly maxDy: number;
  /** Original order, to restore on Escape. */
  readonly original: readonly string[];
  index: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Drag-and-keyboard reorderable list (§8.1 management screens). Pointer
 *  drag on the handle swaps rows when the pointer crosses a neighbour's
 *  midpoint; the handle is also a keyboard drag: Space grabs, ArrowUp/Down
 *  move, Space drops, Escape cancels — announced via a polite live region. */
export function ReorderList({
  ids,
  label,
  ariaLabel,
  onReorder,
  renderItem,
}: ReorderListProps): React.JSX.Element {
  const idsKey = ids.join('\n');
  // Render-phase reset: follow the server's list whenever its content changes.
  const [state, setState] = useState(() => ({ key: idsKey, order: [...ids] }));
  if (state.key !== idsKey) setState({ key: idsKey, order: [...ids] });

  const [drag, setDrag] = useState<DragState | null>(null);
  const [live, setLive] = useState('');
  const orderRef = useRef(state.order);
  const dragRef = useRef<DragRef | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const onReorderRef = useRef(onReorder);

  useEffect(() => {
    orderRef.current = state.order;
  }, [state.order]);
  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const setOrder = (order: readonly string[]): void => {
    orderRef.current = [...order];
    setState((prev) => ({ ...prev, order: [...order] }));
  };

  const release = (commit: boolean): void => {
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (active === null) return;
    if (commit) {
      const order = orderRef.current;
      const changed =
        order.length !== active.original.length ||
        order.some((id, index) => id !== active.original[index]);
      // A bare tap on the handle (grab + release, no movement) must not
      // re-PATCH an unchanged order.
      if (changed) onReorderRef.current(order);
      setLive(`${label(active.id)} dropped.`);
    } else {
      setOrder(active.original);
      setLive('Reorder cancelled.');
    }
  };

  const grabPointer = (id: string, event: React.PointerEvent<HTMLButtonElement>): void => {
    const listEl = listRef.current;
    const dragged = rowRefs.current.get(id);
    if (listEl === null || dragged === undefined) return;
    const rows = orderRef.current
      .map((rowId) => ({ rowId, rect: rowRefs.current.get(rowId)?.getBoundingClientRect() }))
      .filter((row): row is { rowId: string; rect: DOMRect } => row.rect !== undefined);
    const draggedRect = dragged.getBoundingClientRect();
    const others = rows
      .filter((row) => row.rowId !== id)
      .map((row) => row.rect.top + row.rect.height / 2);
    if (others.length === 0) return;
    const listTop = Math.min(...rows.map((row) => row.rect.top));
    const listBottom = Math.max(...rows.map((row) => row.rect.bottom));
    // Capture the list container, not the handle: reordering moves <li>
    // nodes, which implicitly releases an element capture mid-drag and
    // strands the pointerup. The UL is stable for the whole gesture.
    listEl.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startY: event.clientY,
      others,
      minDy: listTop - draggedRect.top,
      maxDy: listBottom - draggedRect.bottom,
      original: orderRef.current,
      index: orderRef.current.indexOf(id),
    };
    setDrag({ id, dy: 0, keyboard: false });
  };

  const movePointer = (event: React.PointerEvent<HTMLElement>): void => {
    const active = dragRef.current;
    if (active === null || event.pointerId !== active.pointerId) return;
    const target = insertionIndex(active.others, event.clientY);
    if (target !== active.index) {
      setOrder(moveTo(orderRef.current, active.index, target));
      active.index = target;
    }
    setDrag({
      id: active.id,
      dy: clamp(event.clientY - active.startY, active.minDy, active.maxDy),
      keyboard: false,
    });
  };

  const onKeyDown = (id: string, event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const active = dragRef.current;
    if (active === null) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        const index = orderRef.current.indexOf(id);
        const order = orderRef.current;
        dragRef.current = {
          id,
          pointerId: -1,
          startY: 0,
          others: [],
          minDy: 0,
          maxDy: 0,
          original: order,
          index,
        };
        setDrag({ id, dy: 0, keyboard: true });
        setLive(
          `${label(id)} grabbed. Use the up and down arrow keys to move it, then press Space to drop, Escape to cancel.`,
        );
      }
      return;
    }
    if (active.id !== id) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const target = active.index + (event.key === 'ArrowUp' ? -1 : 1);
      if (target < 0 || target >= orderRef.current.length) return;
      setOrder(moveTo(orderRef.current, active.index, target));
      dragRef.current = { ...active, index: target };
      setLive(`Position ${target + 1} of ${orderRef.current.length}.`);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      release(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      release(false);
    }
  };

  const hintId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-reorder-hint`;

  return (
    <div>
      <ul
        ref={listRef}
        aria-label={ariaLabel}
        className="flex flex-col"
        onPointerMove={movePointer}
        onPointerUp={() => release(true)}
        onPointerCancel={() => release(false)}
      >
        {state.order.map((id) => {
          const isDragged = drag?.id === id;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el === null) rowRefs.current.delete(id);
                else rowRefs.current.set(id, el);
              }}
              className={cn(
                'flex items-stretch',
                isDragged && 'relative z-10 rounded-card bg-surface shadow-lg',
              )}
              style={isDragged ? { transform: `translateY(${drag?.dy ?? 0}px)` } : undefined}
            >
              <button
                type="button"
                aria-label={`Reorder ${label(id)}`}
                aria-describedby={hintId}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  grabPointer(id, event);
                }}
                onContextMenu={(event) => {
                  if (dragRef.current !== null) event.preventDefault();
                }}
                onKeyDown={(event) => onKeyDown(id, event)}
                className={cn(
                  'flex w-11 shrink-0 cursor-grab items-center justify-center text-muted',
                  'touch-none select-none hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                  'active:cursor-grabbing',
                  isDragged && 'text-accent',
                  drag?.keyboard === true && isDragged && 'outline-2 -outline-offset-2 outline-accent',
                )}
              >
                <GripVertical aria-hidden="true" className="size-5" />
              </button>
              {renderItem(id, isDragged === true)}
            </li>
          );
        })}
      </ul>
      <p id={hintId} className="sr-only">
        Press Space on the reorder handle to pick up a row, then use the arrow keys to move it.
      </p>
      <p aria-live="polite" role="status" className="sr-only">
        {live}
      </p>
    </div>
  );
}
