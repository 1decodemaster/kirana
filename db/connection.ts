import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fold, normalizeName } from '@kirana/shared';

export const PRAGMAS = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['foreign_keys', 'ON'],
  ['busy_timeout', 5000],
  ['temp_store', 'MEMORY'],
] as const;

/** §5.3: the FTS keys blob is maintained by triggers, so normalization must
 * be computable in SQL. These registered functions are the single source of
 * truth — the same shared implementations the services use. */
function registerTextFunctions(db: Database.Database): void {
  db.function('kirana_norm', { deterministic: true }, (s: unknown) =>
    typeof s === 'string' ? normalizeName(s) : '',
  );
  db.function('kirana_fold', { deterministic: true }, (s: unknown) =>
    typeof s === 'string' ? fold(s) : '',
  );
}

export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  for (const [key, value] of PRAGMAS) {
    db.pragma(`${key} = ${value}`);
  }
  registerTextFunctions(db);
  return db;
}

export function defaultDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? './data/kirana.db';
}
