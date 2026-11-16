import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { newUuidV7, normalizeName } from '@kirana/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { resolveActor, type ActorContext } from '../services/actor.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    dataDir: '/tmp',
    databaseUrl: ':memory:',
    migrationsDir: MIGRATIONS_DIR,
    appOrigin: 'http://localhost:8080',
    sessionSecret: 'test-secret',
    logLevel: (process.env.TEST_LOG_LEVEL ?? 'fatal') as AppConfig['logLevel'],
    webDistDir: undefined,
    version: '0.1.0',
    revision: 'testrev',
    backupKeepDaily: 14,
    ...overrides,
  };
}

export async function buildTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp(makeConfig(overrides));
  await app.ready();
  return app;
}

export const MUTATION_HEADERS = { 'x-requested-with': 'kirana' } as const;

export interface InjectOptions {
  readonly payload?: unknown;
  readonly headers?: Record<string, string>;
}

export async function injectJson(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: InjectOptions = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    ...(options.payload === undefined ? {} : { payload: options.payload as never }),
    headers: {
      ...(method === 'GET' ? {} : MUTATION_HEADERS),
      ...options.headers,
    },
  });
}

/** Deterministic clock for arranging fixtures and driving mutations. */
export class FakeClock {
  private t: number;
  constructor(start = 1_730_000_000_000) {
    this.t = start;
  }
  now(): number {
    this.t += 1;
    return this.t;
  }
}

export function actor(app: FastifyInstance, clock: FakeClock): ActorContext {
  return resolveActor(app.db, clock.now());
}

export function seedStore(
  app: FastifyInstance,
  householdId: string,
  name: string,
  createdAt: number,
  categoryOrder: readonly string[] = [],
): string {
  const id = newUuidV7(createdAt);
  app.db
    .prepare(
      `INSERT INTO stores (id, household_id, name, name_norm, icon_kind, icon_ref, status,
              category_order_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'emoji', '🏬', 'active', ?, 0, ?, ?)`,
    )
    .run(id, householdId, name, normalizeName(name), JSON.stringify(categoryOrder), createdAt, createdAt);
  return id;
}

export function seedCategory(
  app: FastifyInstance,
  householdId: string | null,
  name: string,
  sortOrder: number,
): string {
  const id = newUuidV7(1_700_000_000_000 + sortOrder);
  app.db
    .prepare(
      `INSERT INTO categories (id, household_id, name, name_norm, scope, icon, color, sort_order, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'grocery', '🥬', '#22C55E', ?, 1, ?, ?)`,
    )
    .run(id, householdId, name, normalizeName(name), sortOrder, 1_700_000_000_000, 1_700_000_000_000);
  return id;
}

/** Id of a category from the seeded §14.1 set (ux_categories_name blocks
 *  re-inserting the same name, so tests look these up instead). */
export function seededCategoryId(app: FastifyInstance, name: string): string {
  const row = app.db
    .prepare('SELECT id FROM categories WHERE name = ? AND deleted_at IS NULL')
    .get(name) as { id: string } | undefined;
  if (row === undefined) throw new Error(`seeded category not found: ${name}`);
  return row.id;
}

export function seedCatalogItem(
  app: FastifyInstance,
  householdId: string,
  name: string,
  createdAt: number,
  defaults: { unit?: string; categoryId?: string; icon?: string } = {},
): string {
  const id = newUuidV7(createdAt);
  app.db
    .prepare(
      `INSERT INTO items (id, household_id, name, name_norm, default_category_id,
              default_unit_code, icon_kind, icon_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'emoji', ?, ?, ?)`,
    )
    .run(
      id,
      householdId,
      name,
      name.toLowerCase(),
      defaults.categoryId ?? null,
      defaults.unit ?? null,
      defaults.icon ?? null,
      createdAt,
      createdAt,
    );
  return id;
}

export interface SeedListItemInput {
  readonly storeId: string;
  readonly itemId: string;
  readonly status?: 'active' | 'bought';
  readonly qty?: number | null;
  readonly unit?: string | null;
  readonly categoryId?: string | null;
  readonly note?: string | null;
  readonly sortOrder?: number;
  readonly createdAt: number;
}

export function seedListItem(app: FastifyInstance, input: SeedListItemInput): string {
  const id = newUuidV7(input.createdAt);
  const status = input.status ?? 'active';
  app.db
    .prepare(
      `INSERT INTO list_items (id, store_id, item_id, qty_value, unit_code, category_id,
              note, status, checked_at, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.storeId,
      input.itemId,
      input.qty ?? null,
      input.unit ?? null,
      input.categoryId ?? null,
      input.note ?? null,
      status,
      status === 'bought' ? input.createdAt : null,
      input.sortOrder ?? 0,
      input.createdAt,
      input.createdAt,
    );
  return id;
}
