import type Database from 'better-sqlite3';
import { newUuidV7, normalizeName } from '@kirana/shared';
import { hashPasscode } from './passcode.js';
import { seedCategories, seedHouseholdCatalog } from './seed.js';

/** Known passcode for dev/e2e households (§8.9 minimum length). */
export const DEMO_PASSCODE = '0000';

export interface DemoSeedResult {
  readonly stores: number;
  readonly listItems: number;
  readonly skipped: boolean;
}

interface DemoListEntry {
  readonly item: string;
  readonly qty: number | null;
  readonly unit: string | null;
  readonly status: 'active' | 'bought';
}

interface DemoStore {
  readonly name: string;
  readonly iconRef: string;
  readonly entries: readonly DemoListEntry[];
}

const DEMO_MEMBERS: ReadonlyArray<{ readonly displayName: string; readonly color: string }> = [
  { displayName: 'Alex', color: '#4F46E5' },
  { displayName: 'Sam', color: '#059669' },
];

const DEMO_STORES: readonly DemoStore[] = [
  {
    name: 'Costco',
    iconRef: '🏬',
    entries: [
      { item: 'Basmati Rice', qty: 5, unit: 'kg', status: 'active' },
      { item: 'Cooking Oil', qty: 2, unit: 'l', status: 'active' },
      { item: 'Biscuits', qty: 2, unit: 'pack', status: 'bought' },
      { item: 'Garbage Bags', qty: 1, unit: 'pack', status: 'active' },
      { item: 'Dish Soap', qty: 2, unit: 'ea', status: 'bought' },
    ],
  },
  {
    name: 'Indian Store',
    iconRef: '🛒',
    entries: [
      { item: 'Toor Dal', qty: 2, unit: 'kg', status: 'active' },
      { item: 'Paneer', qty: 500, unit: 'g', status: 'active' },
      { item: 'Curd', qty: 1, unit: 'kg', status: 'active' },
      { item: 'Green Chilli', qty: 100, unit: 'g', status: 'active' },
      { item: 'Coriander', qty: 1, unit: 'pack', status: 'bought' },
      { item: 'Garam Masala', qty: 1, unit: 'pack', status: 'active' },
      { item: 'Tea', qty: 500, unit: 'g', status: 'active' },
      { item: 'Mustard Oil', qty: 1, unit: 'l', status: 'active' },
      { item: 'Atta', qty: 10, unit: 'kg', status: 'bought' },
    ],
  },
  {
    name: 'Target',
    iconRef: '🏪',
    entries: [
      { item: 'Toothpaste', qty: 2, unit: 'ea', status: 'active' },
      { item: 'Shampoo', qty: 1, unit: 'ea', status: 'active' },
      { item: 'Toilet Paper', qty: 1, unit: 'pack', status: 'active' },
      { item: 'Batteries', qty: 1, unit: 'pack', status: 'bought' },
      { item: 'Light Bulbs', qty: 2, unit: 'ea', status: 'active' },
      { item: 'Notebook', qty: 3, unit: 'ea', status: 'active' },
    ],
  },
];

/**
 * Demo data for development and E2E (P1 "seed-driven demo data script").
 * Idempotent and non-destructive: categories and the sample catalog are
 * seeded if missing; demo stores are only created when the household has
 * none, so a user's own board is never touched.
 */
export async function seedDemoBoard(db: Database.Database, now: number): Promise<DemoSeedResult> {
  const household = db
    .prepare('SELECT id FROM households ORDER BY created_at, id LIMIT 1')
    .get() as { id: string } | undefined;

  let householdId: string;
  if (household === undefined) {
    householdId = newUuidV7(now);
    // Usable demo passcode (ADR-0006): dev containers and the e2e harness
    // log in with DEMO_PASSCODE.
    const passcodeHash = await hashPasscode(DEMO_PASSCODE);
    db.prepare(
      'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run(householdId, 'Home', passcodeHash, now);
    db.prepare(
      'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(newUuidV7(now), householdId, 'You', '#4F46E5', now);
  } else {
    householdId = household.id;
  }

  const existingStores = db
    .prepare('SELECT COUNT(*) AS n FROM stores WHERE household_id = ? AND deleted_at IS NULL')
    .get(householdId) as { n: number };
  if (existingStores.n > 0) {
    return { stores: 0, listItems: 0, skipped: true };
  }

  seedCategories(db, now);
  seedHouseholdCatalog(db, householdId, now);

  for (const member of DEMO_MEMBERS) {
    const exists = db
      .prepare(
        'SELECT 1 FROM members WHERE household_id = ? AND display_name = ? AND deleted_at IS NULL',
      )
      .get(householdId, member.displayName);
    if (!exists) {
      db.prepare(
        'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(newUuidV7(now), householdId, member.displayName, member.color, now);
    }
  }

  const members = db
    .prepare(
      'SELECT id, display_name FROM members WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at',
    )
    .all(householdId) as Array<{ id: string; display_name: string }>;
  const memberByName = new Map(members.map((m) => [m.display_name, m.id]));
  const alex = memberByName.get('Alex') ?? null;

  const items = db
    .prepare(
      'SELECT id, name, default_category_id FROM items WHERE household_id = ? AND deleted_at IS NULL',
    )
    .all(householdId) as Array<{ id: string; name: string; default_category_id: string | null }>;
  const itemByName = new Map(items.map((i) => [i.name, i]));

  const insertStore = db.prepare(
    `INSERT INTO stores (id, household_id, name, name_norm, icon_kind, icon_ref, status,
            category_order_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'emoji', ?, 'active', '[]', ?, ?, ?)`,
  );
  const insertListRow = db.prepare(
    `INSERT INTO list_items (id, store_id, item_id, qty_value, unit_code, category_id,
            status, checked_at, checked_by, added_by, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let listItems = 0;
  let createdStores = 0;
  db.transaction(() => {
    DEMO_STORES.forEach((store, storeIndex) => {
      const storeId = newUuidV7(now + storeIndex);
      insertStore.run(
        storeId,
        householdId,
        store.name,
        normalizeName(store.name),
        store.iconRef,
        storeIndex,
        now + storeIndex,
        now + storeIndex,
      );
      createdStores += 1;

      store.entries.forEach((entry, entryIndex) => {
        const item = itemByName.get(entry.item);
        if (item === undefined) {
          throw new Error(`demo seed: catalog item missing: ${entry.item}`);
        }
        const bought = entry.status === 'bought';
        const createdAt = now + 1000 + storeIndex * 100 + entryIndex;
        insertListRow.run(
          newUuidV7(createdAt),
          storeId,
          item.id,
          entry.qty,
          entry.unit,
          item.default_category_id,
          entry.status,
          bought ? createdAt : null,
          bought ? alex : null,
          alex,
          entryIndex,
          createdAt,
          createdAt,
        );
        listItems += 1;
      });
    });
  })();

  return { stores: createdStores, listItems, skipped: false };
}
