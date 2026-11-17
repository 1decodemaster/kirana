import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase, defaultDatabaseUrl } from './connection.js';
import { computeSchemaHash, loadMigrations, migrate } from './migrate.js';
import { seedCategories, seedHouseholdCatalog } from './seed.js';
import { DEMO_PASSCODE, seedDemoBoard } from './demo.js';
import { setHouseholdPasscode } from './passcode.js';

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
    'usage: tsx cli.ts <migrate | seed-categories | seed-catalog --household <id> | seed-demo | reindex | reset-passcode [--passcode <value>] | hash-schema>',
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
    case 'seed-demo': {
      const result = await seedDemoBoard(db, Date.now());
      console.log(
        result.skipped
          ? 'demo data skipped (household already has stores)'
          : `demo data: ${result.stores} stores, ${result.listItems} list items`,
      );
      break;
    }
    case 'reset-passcode': {
      // Recovery for pre-P4 databases (ADR-0006): their passcode_hash is a
      // discarded secret nothing can match. Replaces it; data is untouched.
      const flagIndex = args.indexOf('--passcode');
      const passcode = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
      if (flagIndex >= 0 && !passcode) usage();
      const household = await setHouseholdPasscode(db, passcode ?? DEMO_PASSCODE);
      console.log(`passcode replaced for household "${household.name}" (${household.id})`);
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
