import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../connection.js';
import { loadMigrations, migrate } from '../migrate.js';
import { loadSeedCategories, loadSeedItems, seedCategories, seedHouseholdCatalog } from '../seed.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const migrations = loadMigrations(MIGRATIONS_DIR);
const HH = '01913b5e-7d5a-7000-8000-00000000000a';
const NOW = 1730000000000;

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, migrations);
});

describe('seed file integrity (PRD §14)', () => {
  it('ships 26 seeded categories: 14 grocery + 12 household (§14.1)', () => {
    const categories = loadSeedCategories();
    expect(categories).toHaveLength(26);
    expect(categories.filter((c) => c.scope === 'grocery')).toHaveLength(14);
    expect(categories.filter((c) => c.scope === 'household')).toHaveLength(12);
  });

  it('uses sort_order in tens within each scope', () => {
    for (const scope of ['grocery', 'household'] as const) {
      const orders = loadSeedCategories()
        .filter((c) => c.scope === scope)
        .map((c) => c.sortOrder);
      for (const o of orders) {
        expect(o % 10).toBe(0);
      }
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('ships the 40 required sample items (§14.2)', () => {
    const items = loadSeedItems();
    expect(items).toHaveLength(40);
    const names = new Set(items.map((i) => i.name));
    for (const required of [
      'Atta',
      'Basmati Rice',
      'Toor Dal',
      'Chana Dal',
      'Moong Dal',
      'Paneer',
      'Curd',
      'Milk',
      'Ghee',
      'Eggs',
      'Onion',
      'Tomato',
      'Potato',
      'Garlic',
      'Ginger',
      'Green Chilli',
      'Coriander',
      'Cumin',
      'Turmeric',
      'Red Chilli Powder',
      'Garam Masala',
      'Salt',
      'Sugar',
      'Tea',
      'Coffee',
      'Bhujia',
      'Biscuits',
      'Cooking Oil',
      'Mustard Oil',
      'Dish Soap',
      'Laundry Detergent',
      'Toilet Cleaner',
      'Shampoo',
      'Toothpaste',
      'Toilet Paper',
      'Foil',
      'Garbage Bags',
      'Batteries',
      'Light Bulbs',
      'Notebook',
    ]) {
      expect(names.has(required), required).toBe(true);
    }
  });

  it('gives Basmati Rice the PRD §14.2 example aliases', () => {
    const rice = loadSeedItems().find((i) => i.name === 'Basmati Rice');
    const aliases = rice?.aliases.map((a) => a.alias) ?? [];
    expect(aliases).toEqual(expect.arrayContaining(['chawal', 'chaawal', 'चावल', 'rice']));
  });
});

describe('seedCategories (G0.3)', () => {
  it('seeds global categories idempotently — run twice, same rows', () => {
    expect(seedCategories(db, NOW)).toBe(26);
    const first = countCategories(db);
    expect(seedCategories(db, NOW + 1000)).toBe(0);
    expect(countCategories(db)).toEqual(first);
    expect(first).toEqual({ total: 26, seed: 26, grocery: 14, household: 12 });
  });
});

describe('seedHouseholdCatalog (G0.3)', () => {
  beforeEach(() => {
    seedCategories(db, NOW);
    db.prepare('INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)').run(
      HH,
      'Home',
      'scrypt$16384$8$1$s$hh',
      NOW,
    );
  });

  it('seeds the 40-item catalog with aliases, idempotently', () => {
    const first = seedHouseholdCatalog(db, HH, NOW);
    expect(first.items).toBe(40);
    const aliasesAfterFirst = first.aliases;
    expect(aliasesAfterFirst).toBeGreaterThan(40);

    const second = seedHouseholdCatalog(db, HH, NOW + 1000);
    expect(second).toEqual(first);

    const items = db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    const aliases = db.prepare('SELECT COUNT(*) AS n FROM item_aliases').get() as { n: number };
    expect(items.n).toBe(40);
    expect(aliases.n).toBe(aliasesAfterFirst);
  });

  it('resolves seeded categories and keeps FTS in sync', () => {
    seedHouseholdCatalog(db, HH, NOW);
    const rice = db
      .prepare("SELECT default_category_id FROM items WHERE name_norm = 'basmati rice'")
      .get() as { default_category_id: string };
    const grains = db
      .prepare("SELECT id FROM categories WHERE name = 'Grains & Lentils'")
      .get() as { id: string };
    expect(rice.default_category_id).toBe(grains.id);

    const fts = db.prepare("SELECT item_id FROM item_search WHERE item_search MATCH 'chawal'").all() as Array<{
      item_id: string;
    }>;
    const riceId = db.prepare("SELECT id FROM items WHERE name_norm = 'basmati rice'").get() as { id: string };
    expect(fts.map((r) => r.item_id)).toContain(riceId.id);
  });

  it('rejects an unknown household', () => {
    expect(() => seedHouseholdCatalog(db, '01913b5e-7d5a-7000-8000-0000000000ff', NOW)).toThrow(
      /household not found/,
    );
  });
});

function countCategories(database: Database.Database): {
  total: number;
  seed: number;
  grocery: number;
  household: number;
} {
  const total = (database.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  const seed = (
    database.prepare('SELECT COUNT(*) AS n FROM categories WHERE is_seed = 1').get() as { n: number }
  ).n;
  const grocery = (
    database.prepare("SELECT COUNT(*) AS n FROM categories WHERE scope = 'grocery'").get() as { n: number }
  ).n;
  const household = (
    database.prepare("SELECT COUNT(*) AS n FROM categories WHERE scope = 'household'").get() as { n: number }
  ).n;
  return { total, seed, grocery, household };
}
