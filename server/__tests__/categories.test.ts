import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoriesResponseSchema } from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import {
  actor,
  buildTestApp,
  FakeClock,
  injectJson,
  seedCatalogItem,
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
  householdId = actor(app, clock).householdId;
});

afterAll(async () => {
  await app.close();
});

describe('GET /categories (§7.2 #23)', () => {
  it('returns the seeded category set with zero usage on a fresh board', async () => {
    seedCategories(app.db, clock.now());
    const res = await injectJson(app, 'GET', '/api/v1/categories');
    expect(res.statusCode).toBe(200);
    const body = categoriesResponseSchema.parse(res.json());
    expect(body.categories.length).toBe(26);
    expect(body.categories.every((c) => c.itemCount === 0)).toBe(true);
    // Grocery Produce and household Cleaning Supplies both have sortOrder 0;
    // the tie breaks alphabetically, so assert membership, not position.
    expect(body.categories.some((c) => c.name === 'Produce')).toBe(true);
    expect(body.categories.some((c) => c.name === 'Cleaning Supplies')).toBe(true);
  });

  it('counts active+bought list rows per category across non-deleted stores', async () => {
    seedCategories(app.db, clock.now());
    const produce = seededCategoryId(app, 'Produce');
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    for (const name of ['Tomatoes', 'Onions']) {
      const item = seedCatalogItem(app, householdId, name, clock.now());
      seedListItem(app, { storeId, itemId: item, categoryId: produce, createdAt: clock.now() });
    }
    const milk = seedCatalogItem(app, householdId, 'Milk', clock.now());
    seedListItem(app, { storeId, itemId: milk, categoryId: dairy, status: 'bought', createdAt: clock.now() });
    const cleared = seedCatalogItem(app, householdId, 'Curd', clock.now());
    seedListItem(app, { storeId, itemId: cleared, categoryId: dairy, status: 'bought', createdAt: clock.now() });
    app.db.prepare("UPDATE list_items SET status = 'cleared' WHERE item_id = ?").run(cleared);

    const res = await injectJson(app, 'GET', '/api/v1/categories');
    const body = categoriesResponseSchema.parse(res.json());
    const byName = new Map(body.categories.map((c) => [c.name, c]));
    expect(byName.get('Produce')?.itemCount).toBe(2);
    expect(byName.get('Dairy & Eggs')?.itemCount).toBe(1);
  });
});
