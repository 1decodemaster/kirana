import type Database from 'better-sqlite3';
import { fold, newUuidV7, normalizeName } from '@kirana/shared';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UNITS, type UnitCode } from '@kirana/shared';

export interface SeedCategory {
  readonly name: string;
  readonly scope: string;
  readonly icon: string;
  readonly color: string;
  readonly sortOrder: number;
}

export interface SeedAlias {
  readonly alias: string;
  readonly lang: string;
}

export interface SeedItem {
  readonly name: string;
  readonly category: string;
  readonly defaultUnit: string;
  readonly emoji: string;
  readonly aliases: readonly SeedAlias[];
}

const LANGS = new Set(['en', 'hi-Latn', 'hi']);
const SCOPES = new Set(['grocery', 'household', 'general']);

export function seedDir(): string {
  const override = process.env.KIRANA_SEED_DIR;
  if (override) return override;
  const here = fileURLToPath(new URL('./seed', import.meta.url));
  if (existsSync(here)) return here;
  const up = fileURLToPath(new URL('../seed', import.meta.url));
  if (existsSync(up)) return up;
  throw new Error('seed directory not found');
}

function loadSeedFile(name: string): unknown {
  return JSON.parse(readFileSync(path.join(seedDir(), name), 'utf8'));
}

export function loadSeedCategories(): SeedCategory[] {
  const raw = loadSeedFile('categories.json') as unknown;
  assertArray(raw, 'categories.json');
  return raw.map((entry, i) => {
    const c = entry as Record<string, unknown>;
    assertString(c.name, `categories[${i}].name`);
    assertString(c.scope, `categories[${i}].scope`);
    if (!SCOPES.has(c.scope)) throw new Error(`categories[${i}].scope invalid: ${c.scope}`);
    assertString(c.icon, `categories[${i}].icon`);
    assertString(c.color, `categories[${i}].color`);
    assertNumber(c.sortOrder, `categories[${i}].sortOrder`);
    return { name: c.name, scope: c.scope, icon: c.icon, color: c.color, sortOrder: c.sortOrder };
  });
}

export function loadSeedItems(): SeedItem[] {
  const raw = loadSeedFile('items.json') as unknown;
  assertArray(raw, 'items.json');
  return raw.map((entry, i) => {
    const it = entry as Record<string, unknown>;
    assertString(it.name, `items[${i}].name`);
    assertString(it.category, `items[${i}].category`);
    assertString(it.defaultUnit, `items[${i}].defaultUnit`);
    if (!Object.hasOwn(UNITS, it.defaultUnit)) {
      throw new Error(`items[${i}].defaultUnit not in unit registry: ${it.defaultUnit}`);
    }
    assertString(it.emoji, `items[${i}].emoji`);
    assertArray(it.aliases, `items[${i}].aliases`);
    const aliases = (it.aliases as unknown[]).map((a, j) => {
      const alias = a as Record<string, unknown>;
      assertString(alias.alias, `items[${i}].aliases[${j}].alias`);
      assertString(alias.lang, `items[${i}].aliases[${j}].lang`);
      if (!LANGS.has(alias.lang)) {
        throw new Error(`items[${i}].aliases[${j}].lang invalid: ${alias.lang}`);
      }
      return { alias: alias.alias, lang: alias.lang };
    });
    return {
      name: it.name,
      category: it.category,
      defaultUnit: it.defaultUnit,
      emoji: it.emoji,
      aliases,
    };
  });
}

export function seedCategories(db: Database.Database, now: number): number {
  const categories = loadSeedCategories();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories
       (id, household_id, name, name_norm, scope, icon, color, sort_order, is_seed, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const c of categories) {
      const result = insert.run(
        newUuidV7(now),
        c.name,
        normalizeName(c.name),
        c.scope,
        c.icon,
        c.color,
        c.sortOrder,
        now,
        now,
      );
      inserted += result.changes;
    }
  })();
  return inserted;
}

export interface SeedCatalogResult {
  readonly items: number;
  readonly aliases: number;
}

export function seedHouseholdCatalog(
  db: Database.Database,
  householdId: string,
  now: number,
): SeedCatalogResult {
  const household = db.prepare('SELECT id FROM households WHERE id = ?').get(householdId);
  if (!household) throw new Error(`household not found: ${householdId}`);

  const items = loadSeedItems();
  const categoryRows = db
    .prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL')
    .all() as Array<{ id: string; name: string }>;
  const categoriesByName = new Map<string, string[]>();
  for (const row of categoryRows) {
    const ids = categoriesByName.get(row.name) ?? [];
    ids.push(row.id);
    categoriesByName.set(row.name, ids);
  }

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO items
       (id, household_id, name, name_norm, default_category_id, default_unit_code, icon_kind, icon_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'emoji', ?, ?, ?)`,
  );
  const findItem = db.prepare(
    'SELECT id FROM items WHERE household_id = ? AND name_norm = ?',
  );
  const insertAlias = db.prepare(
    `INSERT OR IGNORE INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'seed', ?)`,
  );

  db.transaction(() => {
    for (const it of items) {
      const candidates = categoriesByName.get(it.category) ?? [];
      if (candidates.length === 0) {
        throw new Error(`seed item ${it.name}: unknown category ${it.category}`);
      }
      if (candidates.length > 1) {
        throw new Error(`seed item ${it.name}: ambiguous category ${it.category}`);
      }
      const categoryId = candidates[0];
      if (categoryId === undefined) {
        throw new Error(`seed item ${it.name}: category resolution failed for ${it.category}`);
      }
      const norm = normalizeName(it.name);
      insertItem.run(
        newUuidV7(now),
        householdId,
        it.name,
        norm,
        categoryId,
        it.defaultUnit as UnitCode,
        it.emoji,
        now,
        now,
      );
      const row = findItem.get(householdId, norm) as { id: string } | undefined;
      if (!row) throw new Error(`seed item ${it.name}: insert failed`);
      for (const a of it.aliases) {
        insertAlias.run(
          newUuidV7(now),
          row.id,
          a.alias,
          normalizeName(a.alias),
          fold(a.alias),
          a.lang,
          now,
        );
      }
    }
  })();

  const totalItems = db
    .prepare('SELECT COUNT(*) AS n FROM items WHERE household_id = ?')
    .get(householdId) as { n: number };
  const totalAliases = db
    .prepare(
      'SELECT COUNT(*) AS n FROM item_aliases a JOIN items i ON i.id = a.item_id WHERE i.household_id = ?',
    )
    .get(householdId) as { n: number };
  return { items: totalItems.n, aliases: totalAliases.n };
}

function assertArray(v: unknown, where: string): asserts v is unknown[] {
  if (!Array.isArray(v)) throw new Error(`${where} must be an array`);
}

function assertString(v: unknown, where: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${where} must be a non-empty string`);
}

function assertNumber(v: unknown, where: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where} must be a number`);
}
