import type { AddListItemRequest } from './contracts.js';

/** The part of a list row that an add can accumulate into (ADR-0007). */
export interface AccumulateRow {
  readonly qtyValue: number | null;
  readonly unitCode: string | null;
  readonly categoryId: string | null;
  readonly note: string | null;
}

/**
 * ADR-0007: one active row per (store, item). Folding an incoming add into
 * the existing active row:
 *
 * - an add carrying neither qty nor unit changes nothing;
 * - units equal (an unspecified unit inherits the row's) → quantities sum,
 *   treating null as 0 — both-absent stays null;
 * - an explicitly different unit replaces qty+unit only when the add
 *   carries a quantity (a unit-only change without a quantity is
 *   ambiguous and changes nothing);
 * - an explicitly provided note (non-null) or categoryId replaces the row's.
 *
 * Pure: no DB, no clock (AGENTS §5). The caller stamps updated_at, stats
 * and change_log.
 */
export function mergeAddIntoRow<T extends AccumulateRow>(row: T, add: AddListItemRequest): T {
  const carriesQuantity = add.qtyValue !== undefined;
  const carriesUnit = add.unitCode !== undefined;

  let qtyValue = row.qtyValue;
  let unitCode = row.unitCode;

  if (carriesQuantity || carriesUnit) {
    const unit = carriesUnit ? add.unitCode : row.unitCode;
    if (unit === row.unitCode) {
      const existing = row.qtyValue;
      const incoming = add.qtyValue;
      qtyValue =
        existing === null && incoming === undefined ? null : (existing ?? 0) + (incoming ?? 0);
    } else if (carriesQuantity) {
      // Explicitly different unit: the incoming add wins, but only when it
      // says how much.
      qtyValue = add.qtyValue ?? null;
      unitCode = add.unitCode ?? null;
    }
  }

  return {
    ...row,
    qtyValue,
    unitCode,
    categoryId: add.categoryId !== undefined ? add.categoryId : row.categoryId,
    note: add.note !== undefined && add.note !== null ? add.note : row.note,
  };
}
