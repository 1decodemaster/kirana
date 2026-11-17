export { PRAGMAS, openDatabase, defaultDatabaseUrl } from './connection.js';
export { hashPasscode, verifyPasscode, sha256Hex } from './passcode.js';
export {
  loadMigrations,
  migrate,
  listApplied,
  computeSchemaHash,
  readSchemaEntries,
  type Migration,
  type SchemaEntry,
} from './migrate.js';
export {
  loadSeedCategories,
  loadSeedItems,
  seedCategories,
  seedHouseholdCatalog,
  seedDir,
  type SeedAlias,
  type SeedCategory,
  type SeedCatalogResult,
  type SeedItem,
} from './seed.js';
export { seedDemoBoard, DEMO_PASSCODE, type DemoSeedResult } from './demo.js';
export * from './schema.js';
