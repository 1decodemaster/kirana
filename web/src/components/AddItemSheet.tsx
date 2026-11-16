import { Drawer } from 'vaul';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import {
  displayUnit,
  formatQty,
  newUuidV7,
  parseQty,
  unitType,
  UNITS,
  UNIT_CODES,
  type AddListItemRequest,
  type BoardResponse,
  type CategoryDto,
  type StoreDto,
  type UnitCode,
  type UnitType,
} from '@kirana/shared';
import { buildIndex, exactNameOf, resolveLocal, searchCatalog, type CatalogEntry } from '../lib/searchIndex';
import { cn } from '../lib/utils';

const DEBOUNCE_MS = 80;
const SUGGESTION_LIMIT = 5;

const TYPE_LABELS: Readonly<Record<UnitType, string>> = {
  count: 'Count',
  weight: 'Weight',
  volume: 'Volume',
};

const UNIT_TYPES: readonly UnitType[] = ['count', 'weight', 'volume'];

interface AddItemSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: StoreDto;
  readonly board: BoardResponse;
  readonly categories: readonly CategoryDto[];
  readonly pending?: boolean;
  readonly onAdd: (input: { storeId: string; body: AddListItemRequest; displayName: string }) => void;
  readonly onCreateItem: (input: {
    name: string;
    defaultCategoryId?: string;
    defaultUnitCode?: UnitCode;
  }) => Promise<{ item: { id: string } }>;
  readonly onError: (error: unknown) => void;
}

interface SuggestionGroup {
  readonly label: string;
  readonly items: ReturnType<typeof searchCatalog>;
}

export function AddItemSheet({
  open,
  onClose,
  store,
  board,
  categories,
  pending = false,
  onAdd,
  onCreateItem,
  onError,
}: AddItemSheetProps): React.JSX.Element {
  const index: CatalogEntry[] = useMemo(() => buildIndex(board.catalog), [board.catalog]);
  const [nameInput, setNameInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState<UnitCode | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [nearDupName, setNearDupName] = useState<string | null>(null);
  const [nearDupItemId, setNearDupItemId] = useState<string | null>(null);
  const [nearDupExact, setNearDupExact] = useState(false);
  const [pickedSuggestion, setPickedSuggestion] = useState(false);
  const [working, setWorking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // §8.4: 80 ms debounce on the name field.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(nameInput), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [nameInput]);

  useEffect(() => {
    if (open) {
      setNameInput('');
      setDebounced('');
      setQty(null);
      setUnit(null);
      setCategoryId(null);
      setNearDupName(null);
      setNearDupItemId(null);
      setNearDupExact(false);
      setPickedSuggestion(false);
      setWorking(false);
    }
  }, [open]);

  const suggestions = useMemo(
    () => searchCatalog(index, debounced, store.id, Date.now(), SUGGESTION_LIMIT),
    [index, debounced, store.id],
  );
  const inStore: SuggestionGroup = {
    label: 'In this store',
    items: suggestions.filter((s) => s.inStore),
  };
  const alsoCatalog: SuggestionGroup = {
    label: 'Also in your catalog',
    items: suggestions.filter((s) => !s.inStore),
  };

  // §8.4: category chips — recents first, then sort_order.
  const chipCategories = useMemo(() => {
    const recents: string[] = [];
    for (const item of [...store.items].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (item.categoryId !== null && !recents.includes(item.categoryId)) recents.push(item.categoryId);
    }
    const rest = categories
      .filter((c) => !recents.includes(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return [...recents, ...rest.map((c) => c.id)]
      .map((id) => categories.find((c) => c.id === id))
      .filter((c): c is CategoryDto => c !== undefined);
  }, [store.items, categories]);

  const activeType: UnitType = unit !== null ? unitType(unit) : 'count';
  const typeUnits = UNIT_CODES.filter((code) => UNITS[code].type === activeType);

  const onNameChange = (value: string): void => {
    // §6.3 live quick-parse: the quantity moves into the controls, the name
    // field stays clean. Typing (vs picking a suggestion) re-arms the
    // AC-A4 exact-match prompt.
    setPickedSuggestion(false);
    const parsed = parseQty(value);
    if (parsed !== null) {
      setQty(parsed.qty);
      setUnit(parsed.unit);
      setNameInput(parsed.name);
    } else {
      setNameInput(value);
    }
  };

  const setUnitType = (type: UnitType): void => {
    // §6.2: toggling preserves the numeric value and picks a display unit.
    const value = qty ?? 0;
    setUnit(displayUnit(value, type));
  };

  const buildBody = (): AddListItemRequest => {
    return {
      clientId: newUuidV7(Date.now()),
      ...(qty !== null ? { qtyValue: qty } : {}),
      ...(unit !== null ? { unitCode: unit } : {}),
      ...(categoryId !== null ? { categoryId } : {}),
    };
  };

  const submitAdd = async (closeAfter: boolean): Promise<void> => {
    const raw = nameInput.trim();
    if (raw.length === 0 || pending || working) return;
    const parsed = parseQty(raw);
    const name = parsed?.name ?? raw;
    setWorking(true);
    try {
      const decision = resolveLocal(index, name, store.id, Date.now());
      if ((decision.kind === 'exact' || decision.kind === 'alias') && !pickedSuggestion) {
        // AC-A4: a fully-typed name that already exists prompts instead of
        // silently adding. A suggestion tap (pickedSuggestion) is the §8.4
        // 3-tap flow and adds directly.
        setNearDupName(exactNameOf(index, decision.itemId) ?? name);
        setNearDupItemId(decision.itemId);
        setNearDupExact(decision.kind === 'exact');
        return;
      }
      if (decision.kind === 'near-duplicate') {
        const best = decision.suggestions[0];
        if (best !== undefined) {
          setNearDupName(best.name);
          setNearDupItemId(best.id);
          setNearDupExact(false);
        }
        return;
      }
      const body = buildBody();
      if (decision.kind === 'exact' || decision.kind === 'alias') {
        onAdd({
          storeId: store.id,
          body: { ...body, itemId: decision.itemId },
          displayName: name,
        });
      } else {
        onAdd({ storeId: store.id, body: { ...body, name }, displayName: name });
      }
      if (closeAfter) {
        onClose();
      } else {
        setNameInput('');
        setDebounced('');
        setPickedSuggestion(false);
      }
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const useExisting = async (): Promise<void> => {
    if (nearDupItemId === null || pending || working) return;
    setWorking(true);
    try {
      onAdd({
        storeId: store.id,
        body: { ...buildBody(), itemId: nearDupItemId },
        displayName: nearDupName ?? '',
      });
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const createNewAnyway = async (): Promise<void> => {
    const raw = nameInput.trim();
    if (raw.length === 0 || pending || working) return;
    setWorking(true);
    try {
      const parsed = parseQty(raw);
      const name = parsed?.name ?? raw;
      const created = await onCreateItem({
        name,
        ...(categoryId !== null ? { defaultCategoryId: categoryId } : {}),
        ...(unit !== null ? { defaultUnitCode: unit } : {}),
      });
      onAdd({
        storeId: store.id,
        body: { ...buildBody(), itemId: created.item.id },
        displayName: name,
      });
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const canSubmit = nameInput.trim().length > 0 && !pending && !working;

  return (
    <Drawer.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] [max-height:90dvh] w-full max-w-md flex-col rounded-t-card bg-surface p-4 outline-none">
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-store font-semibold">Add to {store.name}</Drawer.Title>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-chip text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <Drawer.Description className="sr-only">
            Search your catalog or type a new item to add to {store.name}.
          </Drawer.Description>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitAdd(true);
            }}
            className="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          >
            <label className="flex flex-col gap-1">
              <span className="text-tab font-semibold uppercase tracking-wide text-muted">Item</span>
              <input
                ref={nameRef}
                type="text"
                value={nameInput}
                onChange={(event) => onNameChange(event.target.value)}
                maxLength={80}
                autoFocus
                enterKeyHint="done"
                autoComplete="off"
                aria-label="Item name"
                placeholder="milk, atta 5kg, प्याज़…"
                className="min-h-11 rounded-chip border border-border bg-bg px-3 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
              />
            </label>

            {nearDupName !== null && (
              <div
                role="alert"
                className="rounded-card border border-border bg-bg p-3"
                data-testid="near-duplicate-card"
              >
                <p className="text-item">You already have {nearDupName}. Use it, or create a new item?</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void useExisting()}
                    className="min-h-11 flex-1 rounded-chip bg-accent px-3 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Use it
                  </button>
                  {!nearDupExact && (
                    <button
                      type="button"
                      onClick={() => void createNewAnyway()}
                      className="min-h-11 flex-1 rounded-chip border border-border px-3 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Create new anyway
                    </button>
                  )}
                </div>
              </div>
            )}

            {suggestions.length > 0 && (
              <div>
                {[
                  { key: 'in-store', group: inStore },
                  { key: 'catalog', group: alsoCatalog },
                ]
                  .filter(({ group }) => group.items.length > 0)
                  .map(({ key, group }) => (
                    <div key={key} className="mb-2">
                      <p className="text-tab font-semibold uppercase tracking-wide text-muted">{group.label}</p>
                      <ul>
                        {group.items.map((suggestion) => (
                          <li key={suggestion.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setNameInput(suggestion.name);
                                setDebounced(suggestion.name);
                                if (suggestion.defaultUnit !== null) setUnit(suggestion.defaultUnit);
                                if (suggestion.defaultCategoryId !== null) setCategoryId(suggestion.defaultCategoryId);
                                setPickedSuggestion(true);
                                setNearDupName(null);
                                setNearDupItemId(null);
                              }}
                              className="flex min-h-11 w-full items-center gap-2 rounded-chip px-2 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                            >
                              <span aria-hidden="true">{suggestion.iconRef ?? '🛒'}</span>
                              <span className="flex-1 text-item">{suggestion.name}</span>
                              {suggestion.defaultUnit !== null && (
                                <span className="text-tab text-muted">{UNITS[suggestion.defaultUnit].label}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}

            {/* min-w-0: a <fieldset>'s UA min-width is min-content, which lets
                the category pill row blow the drawer out to its full scroll
                width (the "app slides left" bug). */}
            <fieldset className="min-w-0">
              <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Quantity</legend>
              <div role="radiogroup" aria-label="Unit type" className="mt-1 flex gap-1">
                {UNIT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={activeType === type}
                    onClick={() => setUnitType(type)}
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
                <label className="ml-auto">
                  <span className="sr-only">Unit</span>
                  <select
                    value={unit ?? displayUnit(qty ?? 0, activeType)}
                    onChange={(event) => setUnit(event.target.value as UnitCode)}
                    className="min-h-11 rounded-chip border border-border bg-bg px-2 text-item focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
                  >
                    {typeUnits.map((code) => (
                      <option key={code} value={code}>
                        {UNITS[code].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="min-w-0">
              <legend className="text-tab font-semibold uppercase tracking-wide text-muted">Category</legend>
              <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
                {chipCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={categoryId === category.id}
                    onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
                    className={cn(
                      'min-h-11 shrink-0 rounded-pill border px-3 text-tab font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      categoryId === category.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                    )}
                  >
                    <span aria-hidden="true">{category.icon ?? ''} </span>
                    {category.name}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="sticky bottom-0 flex gap-2 bg-surface pb-1 pt-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="min-h-11 flex-1 rounded-chip bg-accent px-4 font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submitAdd(false)}
                className="min-h-11 flex-1 rounded-chip border border-border px-4 font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                Add another
              </button>
            </div>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
