import type Database from 'better-sqlite3';
import { loadMigrations, migrate, openDatabase } from '@kirana/db';
import type { AppConfig } from './config.js';

export function openAppDatabase(config: AppConfig): Database.Database {
  const db = openDatabase(config.databaseUrl);
  migrate(db, loadMigrations(config.migrationsDir));
  return db;
}
