import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { newUuidV7 } from '@kirana/shared';
import { openDatabase } from '../connection.js';
import { loadMigrations, migrate } from '../migrate.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const BASE = 1_730_000_000_000;

const allMigrations = loadMigrations(MIGRATIONS_DIR);
const before0004 = allMigrations.filter((m) => !m.name.startsWith('0004'));
const migration0004 = allMigrations.filter((m) => m.name.startsWith('0004'));

let db: ReturnType<typeof openDatabase>;

beforeEach(async () => {
  db = openDatabase(':memory:');
  migrate(db, before0004);
  db.prepare(
    'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(newUuidV7(BASE), 'Home', 'scrypt$16384$8$1$salt$hash', BASE);
});

/** The tests seed pre-0004 duplicates, then apply the consolidation. */
function consolidate(): void {
  migrate(db, migration0004);
}

interface RowSpec {
  readonly storeId: string;
  readonly itemId: string;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly status?: 'active' | 'bought';
  readonly sortOrder?: number;
}

function insertRow(spec: RowSpec, at: number): string {
  const id = newUuidV7(at);
  const status = spec.status ?? 'active';
  db.prepare(
    `INSERT INTO list_items (id, store_id, item_id, qty_value, unit_code, status,
            sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, spec.storeId, spec.itemId, spec.qty, spec.unit, status, spec.sortOrder ?? 0, at, at);
  return id;
}

function seedStoreAndItem(name: string, at: number): { storeId: string; itemId: string } {
  const storeId = newUuidV7(at);
  const itemId = newUuidV7(at + 1);
  db.prepare(
    'INSERT INTO stores (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, (SELECT id FROM households LIMIT 1), ?, ?, ?, ?)',
  ).run(storeId, name, name.toLowerCase(), at, at);
  db.prepare(
    'INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, (SELECT id FROM households LIMIT 1), ?, ?, ?, ?)',
  ).run(itemId, name, name.toLowerCase(), at, at);
  return { storeId, itemId };
}

function activeRows(storeId: string, itemId: string): Array<{ id: string; qty_value: number | null; unit_code: string | null }> {
  return db
    .prepare(
      "SELECT id, qty_value, unit_code FROM list_items WHERE store_id = ? AND item_id = ? AND status = 'active' ORDER BY sort_order",
    )
    .all(storeId, itemId) as Array<{ id: string; qty_value: number | null; unit_code: string | null }>;
}

describe('migration 0004 — duplicate active rows consolidate (ADR-0007)', () => {
  it('sums same-unit duplicates into the first row and removes the rest', () => {
    const { storeId, itemId } = seedStoreAndItem('Milk', BASE);
    const first = insertRow({ storeId, itemId, qty: 2, unit: 'l', sortOrder: 0 }, BASE + 1);
    insertRow({ storeId, itemId, qty: 3, unit: 'l', sortOrder: 1 }, BASE + 2);
    insertRow({ storeId, itemId, qty: null, unit: 'l', sortOrder: 2 }, BASE + 3);

    consolidate();
  const survivors = activeRows(storeId, itemId);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe(first);
    expect(survivors[0]?.qty_value).toBe(5);
    expect(survivors[0]?.unit_code).toBe('l');
  });

  it('an all-quantity-less group stays quantity-less (no phantom 0)', () => {
    const { storeId, itemId } = seedStoreAndItem('Bread', BASE);
    const first = insertRow({ storeId, itemId, qty: null, unit: null, sortOrder: 0 }, BASE + 1);
    insertRow({ storeId, itemId, qty: null, unit: null, sortOrder: 1 }, BASE + 2);

    consolidate();
  const survivors = activeRows(storeId, itemId);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe(first);
    expect(survivors[0]?.qty_value).toBeNull();
  });

  it('a mixed-unit group keeps the survivor\u2019s own qty and unit', () => {
    const { storeId, itemId } = seedStoreAndItem('Rice', BASE);
    const first = insertRow({ storeId, itemId, qty: 2, unit: 'l', sortOrder: 0 }, BASE + 1);
    insertRow({ storeId, itemId, qty: 1, unit: 'kg', sortOrder: 1 }, BASE + 2);

    consolidate();
  const survivors = activeRows(storeId, itemId);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe(first);
    expect(survivors[0]).toMatchObject({ qty_value: 2, unit_code: 'l' });
  });

  it('bought rows never merge and single rows are untouched', () => {
    const { storeId, itemId } = seedStoreAndItem('Eggs', BASE);
    insertRow({ storeId, itemId, qty: 1, unit: 'dozen', status: 'bought', sortOrder: 0 }, BASE + 1);
    const single = insertRow({ storeId, itemId, qty: 2, unit: 'dozen', sortOrder: 1 }, BASE + 2);

    consolidate();
  const survivors = activeRows(storeId, itemId);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe(single);
    const bought = db
      .prepare("SELECT COUNT(*) AS n FROM list_items WHERE item_id = ? AND status = 'bought'")
      .get(itemId) as { n: number };
    expect(bought.n).toBe(1);
  });

  it('different stores keep their own rows', () => {
    // One item, two stores (store names are unique per household).
    const itemId = newUuidV7(BASE + 1);
    db.prepare(
      'INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, (SELECT id FROM households LIMIT 1), ?, ?, ?, ?)',
    ).run(itemId, 'Soap', 'soap', BASE + 1, BASE + 1);
    const storeA = newUuidV7(BASE + 2);
    const storeB = newUuidV7(BASE + 3);
    db.prepare(
      'INSERT INTO stores (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, (SELECT id FROM households LIMIT 1), ?, ?, ?, ?)',
    ).run(storeA, 'Soap A', 'soap a', BASE + 2, BASE + 2);
    db.prepare(
      'INSERT INTO stores (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, (SELECT id FROM households LIMIT 1), ?, ?, ?, ?)',
    ).run(storeB, 'Soap B', 'soap b', BASE + 3, BASE + 3);
    insertRow({ storeId: storeA, itemId, qty: 1, unit: 'ea', sortOrder: 0 }, BASE + 4);
    insertRow({ storeId: storeB, itemId, qty: 2, unit: 'ea', sortOrder: 0 }, BASE + 5);

    consolidate();
    expect(activeRows(storeA, itemId)).toHaveLength(1);
    expect(activeRows(storeB, itemId)).toHaveLength(1);
  });
});
