import type Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { fold, ftsPhraseQueries, normalizeName } from '@kirana/shared';
import { openDatabase } from '../connection.js';
import { loadMigrations, migrate } from '../migrate.js';
import { seedCategories, seedHouseholdCatalog } from '../seed.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const migrations = loadMigrations(MIGRATIONS_DIR);

let db: Database.Database;
const hh = '01913b5e-7d5a-7000-8000-000000000001';
const base = 1730000000000;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, migrations);
  db.prepare('INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)').run(
    hh,
    'Home',
    'scrypt$16384$8$1$salt$hash',
    base,
  );
});

function ftsRow(itemId: string): { keys: string } | undefined {
  return db.prepare('SELECT keys FROM item_search WHERE item_id = ?').get(itemId) as
    | { keys: string }
    | undefined;
}

function insertItem(id: string, name: string, deletedAt: number | null = null): void {
  db.prepare(
    'INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, hh, name, normalizeName(name), base, base, deletedAt);
}

function insertAlias(id: string, itemId: string, alias: string): void {
  db.prepare(
    'INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, itemId, alias, normalizeName(alias), fold(alias), 'en', 'user', base);
}

function matchIds(ftsQuery: string): string[] {
  return (
    db.prepare('SELECT item_id FROM item_search WHERE keys MATCH ?').all(ftsQuery) as Array<{
      item_id: string;
    }>
  ).map((r) => r.item_id);
}

describe('item_search keys blob — trigger-maintained canonical forms (ADR-0002)', () => {
  it('indexes norm(name), fold(name), norm(alias) and the stored alias search_key', () => {
    insertItem('i_0', 'Milk');
    insertAlias('a_0', 'i_0', 'Doodh');
    const row = ftsRow('i_0');
    expect(row?.keys).toBe('milk milk doodh dud');
  });

  it('an item with no aliases still indexes its name in both forms', () => {
    insertItem('i_1', 'Basmati Rice');
    expect(ftsRow('i_1')?.keys.trim()).toBe('basmati rice basmati rice');
  });

  it('MATCH finds items by norm form and fold form (quoted phrases)', () => {
    insertItem('i_0', 'Milk');
    insertAlias('a_0', 'i_0', 'doodh');
    insertItem('i_1', 'Onion');
    insertAlias('a_1', 'i_1', 'pyaaz');
    for (const q of ['milk', 'dood', 'dud', 'MILK']) {
      const { norm, folded } = ftsPhraseQueries(q);
      const ids = new Set<string>();
      for (const fts of [norm, folded]) {
        if (fts !== null) for (const id of matchIds(fts)) ids.add(id);
      }
      expect(ids, q).toEqual(new Set(['i_0']));
    }
    for (const q of ['pya', 'pyaz', 'pyaj']) {
      const { norm, folded } = ftsPhraseQueries(q);
      const ids = new Set<string>();
      for (const fts of [norm, folded]) {
        if (fts !== null) for (const id of matchIds(fts)) ids.add(id);
      }
      expect(ids, q).toEqual(new Set(['i_1']));
    }
  });

  it('queries under 3 codepoints produce no FTS query (SQL/JS tiers cover them)', () => {
    expect(ftsPhraseQueries('ab')).toEqual({ norm: null, folded: null });
    expect(ftsPhraseQueries('दूध')).toEqual({ norm: null, folded: null });
  });

  it('soft-deleted items are excluded; reviving re-indexes them', () => {
    insertItem('i_0', 'Milk', base);
    expect(ftsRow('i_0')).toBeUndefined();
    db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run('i_0');
    expect(ftsRow('i_0')?.keys).toContain('milk');
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(base, 'i_0');
    expect(ftsRow('i_0')).toBeUndefined();
  });

  it('adding, updating and deleting an alias rebuilds the item row', () => {
    insertItem('i_0', 'Milk');
    expect(ftsRow('i_0')?.keys.trim()).toBe('milk milk');
    insertAlias('a_0', 'i_0', 'doodh');
    expect(ftsRow('i_0')?.keys).toContain('dud');
    db.prepare('UPDATE item_aliases SET alias = ?, alias_norm = ?, search_key = ? WHERE id = ?').run(
      'doodhu',
      normalizeName('doodhu'),
      fold('doodhu'),
      'a_0',
    );
    expect(ftsRow('i_0')?.keys).toContain('doodhu');
    db.prepare('DELETE FROM item_aliases WHERE id = ?').run('a_0');
    expect(ftsRow('i_0')?.keys.trim()).toBe('milk milk');
  });

  it('renaming an item rebuilds its row', () => {
    insertItem('i_0', 'Milk');
    db.prepare('UPDATE items SET name = ?, name_norm = ? WHERE id = ?').run(
      'Full Cream Milk',
      normalizeName('Full Cream Milk'),
      'i_0',
    );
    expect(ftsRow('i_0')?.keys.trim()).toBe(
      'full cream milk ful cream milk',
    );
  });
});

describe('item_search after the household catalog seed (G2.4 corpus)', () => {
  it('the seeded catalog is searchable through the FTS prefilter', () => {
    seedCategories(db, base);
    const result = seedHouseholdCatalog(db, hh, base);
    expect(result.items).toBeGreaterThan(0);

    // G2.4 queries that the FTS prefilter must surface (Latin tokens ≥3cp)
    const expectations: Array<[string, string]> = [
      ['pya', 'pyaaz'],
      ['pyaz', 'pyaaz'],
      ['chawa', 'chawal'],
      ['dood', 'doodh'],
    ];
    for (const [q, aliasFragment] of expectations) {
      const { norm, folded } = ftsPhraseQueries(q);
      const queries = [norm, folded].filter((v): v is string => v !== null);
      const hits = new Set<string>();
      for (const fts of queries) for (const id of matchIds(fts)) hits.add(id);
      expect(hits.size, `${q} via ${JSON.stringify(queries)}`).toBeGreaterThan(0);
      // the hit rows must carry the matching alias
      const keys = [...hits].map((id) => ftsRow(id)?.keys ?? '').join(' ');
      expect(keys).toContain(aliasFragment);
    }

    // Devanagari rides the SQL exact/prefix tiers instead (norms mangle below
    // the trigram minimum) — FTS stays silent rather than wrong
    expect(ftsPhraseQueries('प्याज़').norm).toBeNull();
  });
});
