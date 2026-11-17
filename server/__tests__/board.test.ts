import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { boardResponseSchema, newUuidV7, normalizeName } from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import {
  actor,
  buildTestApp,
  FakeClock,
  injectJson,
  seedCatalogItem,
  seedCategory,
  seededCategoryId,
  seedListItem,
  seedStore,
} from './helpers.js';

let app: FastifyInstance;
let clock: FakeClock;
let householdId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app).householdId;
});

afterAll(async () => {
  await app.close();
});

describe('GET /board — shape and bootstrapping (§7.3)', () => {
  it('a fresh db with no session is 401 — households come from the wizard, not lazily (§7.6, P4)', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/board', { auth: false });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('is deterministic under repeated GETs (no phantom revisions)', async () => {
    const a = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const b = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    expect(b.revision).toBe(a.revision);
  });

  it('carries X-Request-Id', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/board');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /board — counts (§6.6) and sorting (§6.8)', () => {
  it('shows bought/total counts and orders items per §6.8', async () => {
    seedCategories(app.db, clock.now());
    const produce = seededCategoryId(app, 'Produce');
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    const snacks = seededCategoryId(app, 'Snacks & Namkeen');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());

    const tomato = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    const onion = seedCatalogItem(app, householdId, 'Onions', clock.now());
    const paneer = seedCatalogItem(app, householdId, 'Paneer', clock.now());
    const curd = seedCatalogItem(app, householdId, 'Curd', clock.now());
    const bhujia = seedCatalogItem(app, householdId, 'Bhujia', clock.now());
    const mystery = seedCatalogItem(app, householdId, 'Mystery Item', clock.now());

    // Category order: snacks before produce before dairy (category_order_json).
    app.db
      .prepare('UPDATE stores SET category_order_json = ? WHERE id = ?')
      .run(JSON.stringify([snacks, produce, dairy]), storeId);

    // Dairy group: bought first by sort_order… no — active first, then bought.
    seedListItem(app, { storeId, itemId: curd, qty: 1, unit: 'kg', categoryId: dairy, sortOrder: 1, createdAt: clock.now() });
    seedListItem(app, { storeId, itemId: paneer, qty: 500, unit: 'g', categoryId: dairy, status: 'bought', sortOrder: 2, createdAt: clock.now() });
    // Produce group: two actives, tie on sort_order → created_at decides.
    seedListItem(app, { storeId, itemId: tomato, qty: 1, unit: 'kg', categoryId: produce, sortOrder: 0, createdAt: 1_730_000_500_000 });
    seedListItem(app, { storeId, itemId: onion, qty: 2, unit: 'kg', categoryId: produce, sortOrder: 0, createdAt: 1_730_000_400_000 });
    // Snacks group: single bought row.
    seedListItem(app, { storeId, itemId: bhujia, qty: 2, unit: 'pack', categoryId: snacks, status: 'bought', sortOrder: 0, createdAt: clock.now() });
    // Unknown category (not in seeds/order) + a null-category row → appended last.
    const unknownCat = seedCategory(app, null, 'Zzz Unknown', 99);
    seedListItem(app, { storeId, itemId: mystery, qty: 1, unit: 'ea', categoryId: unknownCat, sortOrder: 0, createdAt: clock.now() });
    seedListItem(app, { storeId, itemId: onion, qty: 1, unit: 'kg', categoryId: null, sortOrder: 0, createdAt: clock.now() });

    const res = await injectJson(app, 'GET', '/api/v1/board');
    expect(res.statusCode).toBe(200);
    const board = boardResponseSchema.parse(res.json());

    const store = board.stores.find((s) => s.id === storeId);
    expect(store).toBeDefined();
    expect(store?.counts).toEqual({ total: 7, bought: 2 });

    const names = store?.items.map((i) => i.name) ?? [];
    expect(names).toEqual([
      'Bhujia', // snacks (ordered first via category_order_json), bought
      'Onions', // produce, active, older created_at wins the sort_order tie
      'Tomatoes',
      'Curd', // dairy: active before bought
      'Paneer',
      'Mystery Item', // category outside category_order_json → appended
      'Onions', // null-category group → last
    ]);

    const onionRow = store?.items[1];
    expect(onionRow?.qtyValue).toBe(2);
    expect(onionRow?.unitCode).toBe('kg');
    expect(onionRow?.status).toBe('active');
  });

  it('excludes cleared rows from items and counts (§6.7)', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    seedListItem(app, { storeId, itemId: item, categoryId: cat, status: 'bought', createdAt: clock.now() });
    app.db
      .prepare("UPDATE list_items SET status = 'cleared' WHERE store_id = ?")
      .run(storeId);

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const store = board.stores.find((s) => s.id === storeId);
    expect(store?.counts).toEqual({ total: 0, bought: 0 });
    expect(store?.items).toEqual([]);
  });

  it('renders soft-deleted items by name (INV-6)', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    seedListItem(app, { storeId, itemId: item, categoryId: cat, createdAt: clock.now() });
    app.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(clock.now(), item);

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const store = board.stores.find((s) => s.id === storeId);
    expect(store?.items.map((i) => i.name)).toEqual(['Tomatoes']);
    // The catalog excludes soft-deleted items.
    expect(board.catalog.find((c) => c.id === item)).toBeUndefined();
  });
});

describe('GET /board — catalog payload (§7.3)', () => {
  it('includes catalog items with their aliases and defaults', async () => {
    seedCategories(app.db, clock.now());
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    const item = seedCatalogItem(app, householdId, 'Milk', clock.now(), { unit: 'l', categoryId: dairy, icon: '🥛' });
    app.db
      .prepare(
        "INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at) VALUES (?, ?, 'doodh', 'doodh', 'doodh', 'hi-Latn', 'user', ?)",
      )
      .run(newUuidV7(clock.now()), item, clock.now());

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const entry = board.catalog.find((c) => c.id === item);
    expect(entry).toEqual({
      id: item,
      name: 'Milk',
      norm: normalizeName('Milk'),
      aliases: ['doodh'],
      defaultUnit: 'l',
      defaultCategoryId: dairy,
      iconRef: '🥛',
    });
  });

  it('flags catalogTruncated beyond the 5,000 cap', async () => {
    const insert = app.db.prepare(
      `INSERT INTO items (id, household_id, name, name_norm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    app.db.transaction(() => {
      for (let i = 0; i < 5001; i += 1) {
        const name = `Item ${i}`;
        insert.run(newUuidV7(1_720_000_000_000 + i), householdId, name, `item ${i}`, 1_720_000_000_000, 1_720_000_000_000);
      }
    })();

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    expect(board.catalog).toHaveLength(5000);
    expect(board.catalogTruncated).toBe(true);
  });

  it('omits catalogTruncated when the catalog fits', async () => {
    seedCatalogItem(app, householdId, 'Milk', clock.now());
    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    expect(board.catalog).toHaveLength(1);
    expect(board.catalogTruncated).toBeUndefined();
  });
});

describe('GET /board?since — delta payload (§7.2 #5)', () => {
  it('returns only stores touched since the revision', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeA = seedStore(app, householdId, 'Costco', clock.now());
    const storeB = seedStore(app, householdId, 'Target', clock.now());
    const itemA = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    const itemB = seedCatalogItem(app, householdId, 'Milk', clock.now());
    const liA = seedListItem(app, { storeId: storeA, itemId: itemA, categoryId: cat, createdAt: clock.now() });
    seedListItem(app, { storeId: storeB, itemId: itemB, categoryId: cat, createdAt: clock.now() });

    const before = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());

    // Mutate only store A.
    const check = await injectJson(app, 'PATCH', `/api/v1/list-items/${liA}`, {
      payload: { status: 'bought' },
    });
    expect(check.statusCode).toBe(200);

    const delta = boardResponseSchema.parse(
      (await injectJson(app, 'GET', `/api/v1/board?since=${before.revision}`)).json(),
    );
    expect(delta.revision).toBeGreaterThan(before.revision);
    expect(delta.stores.map((s) => s.id)).toEqual([storeA]);
    expect(delta.stores[0]?.counts).toEqual({ total: 1, bought: 1 });

    // No further changes → empty store list.
    const caughtUp = boardResponseSchema.parse(
      (await injectJson(app, 'GET', `/api/v1/board?since=${delta.revision}`)).json(),
    );
    expect(caughtUp.stores).toEqual([]);
  });

  it('returns the full board when since is ahead of the server revision', async () => {
    seedStore(app, householdId, 'Costco', clock.now());
    const full = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const ahead = boardResponseSchema.parse(
      (await injectJson(app, 'GET', `/api/v1/board?since=${full.revision + 9999}`)).json(),
    );
    expect(ahead.stores).toHaveLength(1);
  });

  it('rejects a malformed since with VALIDATION_FAILED', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/board?since=abc');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /board — response contract', () => {
  it('always satisfies the frozen contract schema', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now(), [cat]);
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    seedListItem(app, { storeId, itemId: item, qty: 2, unit: 'kg', categoryId: cat, createdAt: clock.now() });

    const res = await injectJson(app, 'GET', '/api/v1/board');
    // boardResponseSchema is re-exported by @kirana/db in its public surface;
    // parse through the shared contract to prove wire compatibility.
    expect(() => boardResponseSchema.parse(res.json())).not.toThrow();
    const board = boardResponseSchema.parse(res.json());
    expect(board.stores[0]?.items[0]?.name).toBe('Tomatoes');
  });
});
