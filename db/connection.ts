import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const PRAGMAS = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['foreign_keys', 'ON'],
  ['busy_timeout', 5000],
  ['temp_store', 'MEMORY'],
] as const;

export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  for (const [key, value] of PRAGMAS) {
    db.pragma(`${key} = ${value}`);
  }
  return db;
}

export function defaultDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? './data/kirana.db';
}
