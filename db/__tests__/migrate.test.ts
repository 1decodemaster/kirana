import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { newUuidV7 } from '@kirana/shared';
import { openDatabase } from '../connection.js';
import { computeSchemaHash, listApplied, loadMigrations, migrate, readSchemaEntries } from '../migrate.js';
import * as schema from '../schema.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const migrations = loadMigrations(MIGRATIONS_DIR);
const EXPECTED_HASH_FILE = fileURLToPath(new URL('../schema-hash.txt', import.meta.url));

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('migration runner (G0.2)', () => {
  it('applies 0001 and 0002 to a fresh database', () => {
    const applied = migrate(db, migrations);
    expect(applied).toEqual(['0001_init.sql', '0002_item_search_norm_keys.sql']);
    expect(listApplied(db)).toEqual(['0001_init.sql', '0002_item_search_norm_keys.sql']);
  });

  it('is idempotent — a second run applies nothing', () => {
    migrate(db, migrations);
    const applied = migrate(db, migrations);
    expect(applied).toEqual([]);
    expect(listApplied(db)).toEqual(['0001_init.sql', '0002_item_search_norm_keys.sql']);
  });

  it('matches the committed schema hash', () => {
    migrate(db, migrations);
    expect(computeSchemaHash(db)).toBe(readFileSync(EXPECTED_HASH_FILE, 'utf8').trim());
  });

  it('creates all 9 core tables + change_log, 4 P6 tables, and the FTS virtual table', () => {
    migrate(db, migrations);
    const names = readSchemaEntries(db).map((e) => e.name);
    for (const table of [
      'households',
      'members',
      'stores',
      'categories',
      'items',
      'item_aliases',
      'item_store_stats',
      'list_items',
      'change_log',
      'jobs',
      'item_embeddings',
      'item_pairs',
      'llm_cache',
      'item_search',
    ]) {
      expect(names, table).toContain(table);
    }
  });

  it('creates the FTS synchronization triggers (§5.3)', () => {
    migrate(db, migrations);
    const triggers = readSchemaEntries(db).filter((e) => e.type === 'trigger').map((e) => e.name);
    expect(triggers).toEqual(
      expect.arrayContaining([
        'trg_items_fts_insert',
        'trg_items_fts_update',
        'trg_items_fts_delete',
        'trg_aliases_fts_insert',
        'trg_aliases_fts_update',
        'trg_aliases_fts_delete',
      ]),
    );
  });

  it('applies pragmas per §5.1 on every connection', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('temp_store', { simple: true })).toBe(2);
  });
});

describe('data invariants enforced by the schema (§5.4)', () => {
  beforeEach(() => {
    migrate(db, migrations);
  });

  const hh = '01913b5e-7d5a-7000-8000-000000000001';
  const member = '01913b5e-7d5a-7000-8000-000000000002';
  const store = '01913b5e-7d5a-7000-8000-000000000003';
  const item = '01913b5e-7d5a-7000-8000-000000000004';
  const category = '01913b5e-7d5a-7000-8000-000000000005';
  const base = 1730000000000;

  function seedCoreRows(): void {
    db.prepare('INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)').run(
      hh,
      'Home',
      'scrypt$16384$8$1$salt$hash',
      base,
    );
    db.prepare(
      'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(member, hh, 'Alex', '#4F46E5', base);
    db.prepare(
      'INSERT INTO stores (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(store, hh, 'Indian Store', 'indian store', base, base);
    db.prepare(
      'INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(item, hh, 'Milk', 'milk', base, base);
    db.prepare(
      "INSERT INTO categories (id, name, name_norm, scope, is_seed, created_at, updated_at) VALUES (?, 'Dairy & Eggs', 'dairy & eggs', 'grocery', 1, ?, ?)",
    ).run(category, base, base);
  }

  it('INV-3: qty_value must be NULL or > 0', () => {
    seedCoreRows();
    const insert = db.prepare(
      'INSERT INTO list_items (id, store_id, item_id, qty_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(() => insert.run(newUuidV7(base), store, item, 0, base, base)).toThrow();
    expect(() => insert.run(newUuidV7(base), store, item, -1, base, base)).toThrow();
  });

  it('INV-5: (household_id, name_norm) is unique among items', () => {
    seedCoreRows();
    const insert = db.prepare(
      'INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(() => insert.run(newUuidV7(base), hh, 'MILK', 'milk', base, base)).toThrow();
  });

  it('INV-9 stays a service-layer concern but status CHECK rejects garbage', () => {
    seedCoreRows();
    const insert = db.prepare(
      'INSERT INTO list_items (id, store_id, item_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(() => insert.run(newUuidV7(base), store, item, 'purchased', base, base)).toThrow();
  });

  it('FTS stays in sync through triggers when items and aliases change (§5.3)', () => {
    seedCoreRows();
    const alias = db.prepare(
      "INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at) VALUES (?, ?, 'doodh', 'doodh', 'dud', 'hi-Latn', 'user', ?)",
    );
    alias.run(newUuidV7(base), item, base);
    const match = db
      .prepare("SELECT item_id FROM item_search WHERE item_search MATCH 'doodh'")
      .all() as Array<{ item_id: string }>;
    expect(match.map((r) => r.item_id)).toContain(item);
    db.prepare("UPDATE item_aliases SET alias = 'dudh', alias_norm = 'dudh', search_key = 'dud' WHERE item_id = ?").run(
      item,
    );
    const after = db
      .prepare("SELECT item_id FROM item_search WHERE item_search MATCH 'dudh'")
      .all() as Array<{ item_id: string }>;
    expect(after.map((r) => r.item_id)).toContain(item);
    db.prepare('DELETE FROM item_aliases WHERE item_id = ?').run(item);
    const gone = db
      .prepare("SELECT item_id FROM item_search WHERE item_search MATCH 'dudh'")
      .all() as Array<{ item_id: string }>;
    expect(gone.map((r) => r.item_id)).not.toContain(item);
  });

  it('works with the Drizzle schema (typed query smoke test)', () => {
    seedCoreRows();
    const orm = drizzle(db, { schema });
    const rows = orm.select().from(schema.stores).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Indian Store');
  });
});
