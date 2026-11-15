import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  categoryMutationResponseSchema,
  deletedResponseSchema,
  errorResponseSchema,
  newUuidV7,
} from '@kirana/shared';
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
let storeId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app, clock).householdId;
  seedCategories(app.db, clock.now());
  storeId = seedStore(app, householdId, 'Indian Store', clock.now());
});

afterAll(async () => {
  await app.close();
});

describe('POST /categories (§7.2 #24)', () => {
  it('creates a household category with the next sortOrder slot', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Chutneys', scope: 'grocery', icon: '🫙', color: '#22C55E' },
    });
    expect(res.statusCode).toBe(201);
    const body = categoryMutationResponseSchema.parse(res.json());
    expect(body.category.name).toBe('Chutneys');
    expect(body.category.scope).toBe('grocery');
    expect(body.category.icon).toBe('🫙');

    const list = (await injectJson(app, 'GET', '/api/v1/categories')).json() as {
      categories: Array<{ name: string; sortOrder: number }>;
    };
    const others = list.categories.filter((c) => c.name !== 'Chutneys').map((c) => c.sortOrder);
    expect(body.category.sortOrder).toBeGreaterThan(Math.max(...others));
  });

  it('409s against live and soft-deleted rows in the same scope, including seeds', async () => {
    const dupe = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Produce', scope: 'grocery' },
    });
    expect(dupe.statusCode).toBe(409);
    expect(errorResponseSchema.parse(dupe.json()).error.code).toBe('CONFLICT_STALE');

    const mine = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Chutneys', scope: 'grocery' },
    });
    const id = categoryMutationResponseSchema.parse(mine.json()).category.id;
    app.db.prepare('UPDATE categories SET deleted_at = ? WHERE id = ?').run(clock.now(), id);
    // a soft-deleted household row is revived, not duplicated (like stores)
    const ontoDeleted = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'chutneys', scope: 'grocery' },
    });
    expect(ontoDeleted.statusCode).toBe(201);
    expect(categoryMutationResponseSchema.parse(ontoDeleted.json()).category.id).toBe(id);
  });

  it('400s on a bad color (boundary validation)', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Chutneys', scope: 'grocery', color: 'green' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /categories/:id (§7.2 #25)', () => {
  it('renames, reorders, and re-icons a household category', async () => {
    const made = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Chutneys', scope: 'grocery' },
    });
    const id = categoryMutationResponseSchema.parse(made.json()).category.id;

    const res = await injectJson(app, 'PATCH', `/api/v1/categories/${id}`, {
      payload: { name: 'Pickles', sortOrder: -5, icon: '🥒' },
    });
    const body = categoryMutationResponseSchema.parse(res.json());
    expect(body.category.name).toBe('Pickles');
    expect(body.category.sortOrder).toBe(-5);
    expect(body.category.icon).toBe('🥒');
  });

  it('edits a global seed row (single-household deployment, G3.1)', async () => {
    const produce = seededCategoryId(app, 'Produce');
    const res = await injectJson(app, 'PATCH', `/api/v1/categories/${produce}`, {
      payload: { icon: '🍅' },
    });
    expect(categoryMutationResponseSchema.parse(res.json()).category.icon).toBe('🍅');
  });

  it('409s a rename onto a taken norm and 404s unknown ids', async () => {
    const made = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'Chutneys', scope: 'grocery' },
    });
    const id = categoryMutationResponseSchema.parse(made.json()).category.id;
    const taken = await injectJson(app, 'PATCH', `/api/v1/categories/${id}`, {
      payload: { name: 'Produce' },
    });
    expect(taken.statusCode).toBe(409);
    await expect(
      injectJson(app, 'PATCH', `/api/v1/categories/${newUuidV7(clock.now())}`, { payload: { name: 'X' } }),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});

describe('DELETE /categories/:id (§7.2 #26)', () => {
  it('soft-deletes and reassigns list rows, item defaults and stats to Other', async () => {
    const produce = seededCategoryId(app, 'Produce');
    const tomato = seedCatalogItem(app, householdId, 'Tomatoes', clock.now(), { categoryId: produce });
    seedListItem(app, { storeId, itemId: tomato, categoryId: produce, createdAt: clock.now() });
    const bought = seedCatalogItem(app, householdId, 'Onions', clock.now(), { categoryId: produce });
    seedListItem(app, {
      storeId,
      itemId: bought,
      categoryId: produce,
      status: 'bought',
      createdAt: clock.now(),
    });
    app.db
      .prepare('UPDATE item_store_stats SET default_category_id = ? WHERE item_id = ?')
      .run(produce, tomato);
    app.db
      .prepare(
        `INSERT INTO item_store_stats (item_id, store_id, times_added, last_added_at, default_category_id)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .run(tomato, storeId, clock.now(), produce);

    const res = await injectJson(app, 'DELETE', `/api/v1/categories/${produce}`);
    expect(deletedResponseSchema.parse(res.json())).toEqual({ deleted: true });

    const other = seededCategoryId(app, 'Other');
    const listRow = app.db
      .prepare('SELECT category_id FROM list_items WHERE item_id = ?')
      .get(tomato) as { category_id: string | null };
    const clearedRow = app.db
      .prepare('SELECT category_id FROM list_items WHERE item_id = ?')
      .get(bought) as { category_id: string | null };
    expect(listRow.category_id).toBe(other);
    expect(clearedRow.category_id).toBe(other);
    const itemDefault = app.db
      .prepare('SELECT default_category_id FROM items WHERE id = ?')
      .get(tomato) as { default_category_id: string | null };
    expect(itemDefault.default_category_id).toBe(other);
    const stat = app.db
      .prepare('SELECT default_category_id FROM item_store_stats WHERE item_id = ?')
      .get(tomato) as { default_category_id: string | null };
    expect(stat.default_category_id).toBe(other);

    const list = (await injectJson(app, 'GET', '/api/v1/categories')).json() as {
      categories: Array<{ name: string }>;
    };
    expect(list.categories.some((c) => c.name === 'Produce')).toBe(false);
  });

  it('refuses to delete the Other fallback', async () => {
    const other = seededCategoryId(app, 'Other');
    const res = await injectJson(app, 'DELETE', `/api/v1/categories/${other}`);
    expect(res.statusCode).toBe(409);
  });

  it('404s unknown ids', async () => {
    await expect(
      injectJson(app, 'DELETE', `/api/v1/categories/${newUuidV7(clock.now())}`),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});
