import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMigrations, migrate, openDatabase, seedDemoBoard } from '@kirana/db';

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
const DB_FILE = path.join(DB_DIR, 'kirana.db');

const DATA_TABLES = [
  'sessions',
  'list_items',
  'item_store_stats',
  'item_aliases',
  'items',
  'stores',
  'categories',
  'members',
  'households',
  'change_log',
] as const;

/** Fresh, deterministic board state for every run: reset the DB in place
 *  (never unlink it — a reused dev server keeps the old inode open),
 *  migrate, seed the demo board, then reset every row to active so mutation
 *  specs always start from the same place. */
export default async function globalSetup(): Promise<void> {
  mkdirSync(DB_DIR, { recursive: true });
  const db = openDatabase(DB_FILE);
  try {
    migrate(db, loadMigrations(path.join(path.dirname(DB_DIR), '../db/migrations')));
    db.transaction(() => {
      for (const table of DATA_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
    })();
    await seedDemoBoard(db, Date.now());
    db
      .prepare(
        "UPDATE list_items SET status = 'active', checked_at = NULL, checked_by = NULL WHERE status IN ('bought', 'cleared')",
      )
      .run();
  } finally {
    db.close();
  }
}
