import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase, defaultDatabaseUrl } from './connection.js';
import { computeSchemaHash, loadMigrations, migrate } from './migrate.js';
import { seedCategories, seedHouseholdCatalog } from './seed.js';

function migrationsDir(): string {
  const override = process.env.KIRANA_MIGRATIONS_DIR;
  if (override) return override;
  const here = fileURLToPath(new URL('./migrations', import.meta.url));
  if (existsSync(here)) return here;
  const up = fileURLToPath(new URL('../migrations', import.meta.url));
  if (existsSync(up)) return up;
  throw new Error('migrations directory not found');
}

function usage(): never {
  console.error(
    'usage: tsx cli.ts <migrate | seed-categories | seed-catalog --household <id> | reindex | hash-schema>',
  );
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();

const db = openDatabase(defaultDatabaseUrl());
try {
  switch (command) {
    case 'migrate': {
      const applied = migrate(db, loadMigrations(migrationsDir()));
      console.log(applied.length === 0 ? 'nothing to apply' : `applied: ${applied.join(', ')}`);
      break;
    }
    case 'seed-categories': {
      const inserted = seedCategories(db, Date.now());
      console.log(inserted === 0 ? 'categories already seeded' : `seeded ${inserted} categories`);
      break;
    }
    case 'seed-catalog': {
      const flagIndex = args.indexOf('--household');
      const householdId = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
      if (!householdId) usage();
      const result = seedHouseholdCatalog(db, householdId, Date.now());
      console.log(`catalog for household ${householdId}: ${result.items} items, ${result.aliases} aliases`);
      break;
    }
    case 'reindex': {
      db.exec("INSERT INTO item_search(item_search) VALUES('rebuild')");
      console.log('item_search rebuilt');
      break;
    }
    case 'hash-schema': {
      console.log(computeSchemaHash(db));
      break;
    }
    default:
      usage();
  }
} finally {
  db.close();
}
