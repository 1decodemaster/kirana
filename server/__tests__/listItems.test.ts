import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  boardResponseSchema,
  errorResponseSchema,
  listItemMutationResponseSchema,
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

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app).householdId;
});

afterAll(async () => {
  await app.close();
});

interface Fixture {
  readonly storeId: string;
  readonly listItemId: string;
  readonly categoryId: string;
}

async function fixture(status: 'active' | 'bought' = 'active'): Promise<Fixture> {
  seedCategories(app.db, clock.now());
  const categoryId = seededCategoryId(app, 'Produce');
  const storeId = seedStore(app, householdId, 'Costco', clock.now());
  const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
  const listItemId = seedListItem(app, {
    storeId,
    itemId: item,
    categoryId,
    qty: 2,
    unit: 'kg',
    status,
    createdAt: clock.now(),
  });
  return { storeId, listItemId, categoryId };
}

describe('PATCH /list-items/:id (§7.2 #13)', () => {
  it('patches qty, unit, note, category, and sortOrder', async () => {
    const { listItemId, categoryId } = await fixture();
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    const res = await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, {
      payload: { qtyValue: 3, unitCode: 'ea', note: 'ripe ones', categoryId: dairy, sortOrder: 7 },
    });
    expect(res.statusCode).toBe(200);
    const body = listItemMutationResponseSchema.parse(res.json());
    expect(body.listItem).toMatchObject({
      id: listItemId,
      qtyValue: 3,
      unitCode: 'ea',
      note: 'ripe ones',
      categoryId: dairy,
      status: 'active',
    });
    expect(body.listItem.categoryId).not.toBe(categoryId);
  });

  it('rejects qty 0 and negatives (INV-3)', async () => {
    const { listItemId } = await fixture();
    for (const qtyValue of [0, -1]) {
      const res = await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, {
        payload: { qtyValue },
      });
      expect(res.statusCode).toBe(400);
      expect((errorResponseSchema.parse(res.json()).error as { code: string }).code).toBe(
        'VALIDATION_FAILED',
      );
    }
  });

  it('rejects unknown ids and unknown categories', async () => {
    const res = await injectJson(app, 'PATCH', '/api/v1/list-items/00000000-0000-7000-8000-000000000009', {
      payload: { note: 'x' },
    });
    expect(res.statusCode).toBe(404);

    const { listItemId } = await fixture();
    const badCat = await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, {
      payload: { categoryId: '00000000-0000-7000-8000-000000000008' },
    });
    expect(badCat.statusCode).toBe(400);
  });

  it('sets checked_at/checked_by when bought and clears them when active (INV-2)', async () => {
    const { listItemId } = await fixture();
    const bought = await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, {
      payload: { status: 'bought' },
    });
    expect(listItemMutationResponseSchema.parse(bought.json()).listItem.status).toBe('bought');
    const rowAfter = app.db
      .prepare('SELECT checked_at, checked_by, status FROM list_items WHERE id = ?')
      .get(listItemId) as { checked_at: number | null; checked_by: string | null; status: string };
    expect(rowAfter.status).toBe('bought');
    expect(rowAfter.checked_at).not.toBeNull();
    expect(rowAfter.checked_by).not.toBeNull();

    const active = await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, {
      payload: { status: 'active' },
    });
    expect(listItemMutationResponseSchema.parse(active.json()).listItem.status).toBe('active');
    const rowBack = app.db
      .prepare('SELECT checked_at, checked_by FROM list_items WHERE id = ?')
      .get(listItemId) as { checked_at: number | null; checked_by: string | null };
    expect(rowBack.checked_at).toBeNull();
    expect(rowBack.checked_by).toBeNull();
  });

  it('patches are visible on the board with fresh updatedAt', async () => {
    const { storeId, listItemId } = await fixture();
    const before = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const beforeRow = before.stores.find((s) => s.id === storeId)?.items.find((i) => i.id === listItemId);
    await injectJson(app, 'PATCH', `/api/v1/list-items/${listItemId}`, { payload: { qtyValue: 5 } });
    const after = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const afterRow = after.stores.find((s) => s.id === storeId)?.items.find((i) => i.id === listItemId);
    expect(afterRow?.qtyValue).toBe(5);
    expect(afterRow?.updatedAt).toBeGreaterThanOrEqual(beforeRow?.updatedAt ?? 0);
  });
});

describe('DELETE /list-items/:id (§7.2 #14)', () => {
  it('hard-deletes the list row, returns an undo token, and keeps the catalog item', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    const listItemId = seedListItem(app, { storeId, itemId: item, categoryId: cat, createdAt: clock.now() });

    const res = await injectJson(app, 'DELETE', `/api/v1/list-items/${listItemId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { undoToken: string };
    expect(body.undoToken).toMatch(/^[0-9a-f-]{36}$/);

    expect(app.db.prepare('SELECT id FROM list_items WHERE id = ?').get(listItemId)).toBeUndefined();
    expect(app.db.prepare('SELECT id FROM items WHERE id = ?').get(item)).toBeDefined();

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    expect(board.stores.find((s) => s.id === storeId)?.items).toEqual([]);

    const again = await injectJson(app, 'DELETE', `/api/v1/list-items/${listItemId}`);
    expect(again.statusCode).toBe(404);
  });
});

describe('POST /list-items/bulk-check (§7.2 #15)', () => {
  async function threeItems(): Promise<{ storeId: string; ids: string[] }> {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const ids: string[] = [];
    for (const name of ['Tomatoes', 'Onions', 'Paneer']) {
      const item = seedCatalogItem(app, householdId, name, clock.now());
      ids.push(seedListItem(app, { storeId, itemId: item, categoryId: cat, createdAt: clock.now() }));
    }
    return { storeId, ids };
  }

  it('checks and unchecks in bulk, counting only changed rows', async () => {
    const { storeId, ids } = await threeItems();
    const check = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids, checked: true },
    });
    expect(check.statusCode).toBe(200);
    expect((check.json() as { updated: number }).updated).toBe(3);

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const store = board.stores.find((s) => s.id === storeId);
    expect(store?.counts).toEqual({ total: 3, bought: 3 });
    expect(store?.items.every((i) => i.status === 'bought')).toBe(true);

    // Re-checking bought rows changes nothing.
    const repeat = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids, checked: true },
    });
    expect((repeat.json() as { updated: number }).updated).toBe(0);

    const uncheck = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids: ids.slice(0, 2), checked: false },
    });
    expect((uncheck.json() as { updated: number }).updated).toBe(2);
  });

  it('fails atomically when any id is unknown', async () => {
    const { ids } = await threeItems();
    const res = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids: [...ids, '00000000-0000-7000-8000-000000000007'], checked: true },
    });
    expect(res.statusCode).toBe(404);
    const row = app.db.prepare('SELECT status FROM list_items WHERE id = ?').get(ids[0]) as {
      status: string;
    };
    expect(row.status).toBe('active');
  });

  it('rejects an empty ids array', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids: [], checked: true },
    });
    expect(res.statusCode).toBe(400);
  });
});
