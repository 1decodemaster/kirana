import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './connection.js';
import { computeSchemaHash, loadMigrations, migrate } from './migrate.js';

function migrationsDir(): string {
  const here = fileURLToPath(new URL('./migrations', import.meta.url));
  if (existsSync(here)) return here;
  return fileURLToPath(new URL('../migrations', import.meta.url));
}

const db = openDatabase(':memory:');
try {
  migrate(db, loadMigrations(migrationsDir()));
  console.log(computeSchemaHash(db));
} finally {
  db.close();
}
