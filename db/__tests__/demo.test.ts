import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadMigrations, migrate, openDatabase, seedCategories } from '../index.js';
import { seedDemoBoard } from '../demo.js';
import { seedDir } from '../seed.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'kirana-demo-'));
  db = openDatabase(path.join(dir, 'test.db'));
  migrate(db, loadMigrations(path.join(path.dirname(seedDir()), 'migrations')));
});

afterAll(() => {
  db.close();
});

describe('seedDemoBoard', () => {
  it('creates a household, members, three stores, and list items on a fresh DB', () => {
    const result = seedDemoBoard(db, 1_730_000_000_000);
    expect(result.skipped).toBe(false);
    expect(result.stores).toBe(3);
    expect(result.listItems).toBe(20);

    const households = db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
    expect(households.n).toBe(1);
    const members = db
      .prepare('SELECT display_name FROM members ORDER BY created_at')
      .all() as Array<{ display_name: string }>;
    expect(members.map((m) => m.display_name)).toEqual(['You', 'Alex', 'Sam']);
    const stores = db
      .prepare('SELECT name, sort_order FROM stores WHERE deleted_at IS NULL ORDER BY sort_order')
      .all() as Array<{ name: string; sort_order: number }>;
    expect(stores.map((s) => s.name)).toEqual(['Costco', 'Indian Store', 'Target']);
  });

  it('is idempotent: a second run is a no-op (G0.3-style)', () => {
    seedDemoBoard(db, 1_730_000_000_000);
    const before = {
      households: (db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number }).n,
      members: (db.prepare('SELECT COUNT(*) AS n FROM members').get() as { n: number }).n,
      stores: (db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }).n,
      listItems: (db.prepare('SELECT COUNT(*) AS n FROM list_items').get() as { n: number }).n,
    };
    const second = seedDemoBoard(db, 1_730_000_100_000);
    expect(second.skipped).toBe(true);
    expect(second.stores).toBe(0);
    expect(second.listItems).toBe(0);

    const after = {
      households: (db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number }).n,
      members: (db.prepare('SELECT COUNT(*) AS n FROM members').get() as { n: number }).n,
      stores: (db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }).n,
      listItems: (db.prepare('SELECT COUNT(*) AS n FROM list_items').get() as { n: number }).n,
    };
    expect(after).toEqual(before);
  });

  it('never touches a household that already has stores', () => {
    seedDemoBoard(db, 1_730_000_000_000);
    db.prepare("UPDATE stores SET deleted_at = 1730000200000 WHERE name = 'Target'").run();
    // One store remains → not empty → skip.
    const result = seedDemoBoard(db, 1_730_000_300_000);
    expect(result.skipped).toBe(true);
    const stores = db
      .prepare('SELECT COUNT(*) AS n FROM stores WHERE deleted_at IS NULL')
      .get() as { n: number };
    expect(stores.n).toBe(2);
  });

  it('seeds the categories and catalog it depends on', () => {
    seedDemoBoard(db, 1_730_000_000_000);
    const categories = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
    expect(categories.n).toBeGreaterThanOrEqual(26);
    const items = db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    expect(items.n).toBeGreaterThanOrEqual(40);
  });

  it('works after a standalone seedCategories run (no duplicate category errors)', () => {
    expect(() => seedCategories(db, 1_730_000_000_000)).not.toThrow();
    expect(() => seedDemoBoard(db, 1_730_000_100_000)).not.toThrow();
  });
});
