import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  boardResponseSchema,
  clearBoughtResponseSchema,
  deletedResponseSchema,
  errorResponseSchema,
  storeMutationResponseSchema,
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
  householdId = actor(app, clock).householdId;
});

afterAll(async () => {
  await app.close();
});

describe('POST /stores (§7.2 #6)', () => {
  it('creates a store and returns its DTO (201)', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/stores', {
      payload: { name: 'Costco', iconKind: 'emoji', iconRef: '🏬' },
    });
    expect(res.statusCode).toBe(201);
    const body = storeMutationResponseSchema.parse(res.json());
    expect(body.store.name).toBe('Costco');
    expect(body.store.iconRef).toBe('🏬');
    expect(body.store.status).toBe('active');
    expect(body.store.counts).toEqual({ total: 0, bought: 0 });
    expect(body.store.items).toEqual([]);
    expect(body.store.notes).toBeNull();
  });

  it('defaults iconKind to emoji and iconRef to null', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: 'Target' } });
    const body = storeMutationResponseSchema.parse(res.json());
    expect(body.store.iconKind).toBe('emoji');
    expect(body.store.iconRef).toBeNull();
  });

  it('rejects duplicate names case-insensitively (409 CONFLICT_STALE)', async () => {
    await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: 'Costco' } });
    const res = await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: 'costco ' } });
    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('CONFLICT_STALE');
  });

  it('rejects invalid names with VALIDATION_FAILED', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect((errorResponseSchema.parse(res.json()).error as { code: string }).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('revives a soft-deleted store of the same name', async () => {
    const created = storeMutationResponseSchema.parse(
      (await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: 'Costco' } })).json(),
    );
    await injectJson(app, 'DELETE', `/api/v1/stores/${created.store.id}`);
    const again = storeMutationResponseSchema.parse(
      (await injectJson(app, 'POST', '/api/v1/stores', { payload: { name: 'Costco' } })).json(),
    );
    expect(again.store.id).toBe(created.store.id);
    expect(again.store.status).toBe('active');
  });

  it('requires the X-Requested-With header on mutations (§7.1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stores',
      payload: { name: 'Costco' },
    });
    expect(res.statusCode).toBe(403);
    expect((errorResponseSchema.parse(res.json()).error as { code: string }).code).toBe('FORBIDDEN');
  });
});

describe('PATCH /stores/:id (§7.2 #7)', () => {
  async function createStore(name = 'Costco'): Promise<string> {
    const body = storeMutationResponseSchema.parse(
      (await injectJson(app, 'POST', '/api/v1/stores', { payload: { name } })).json(),
    );
    return body.store.id;
  }

  it('renames, re-icons, and reorders', async () => {
    seedCategories(app.db, clock.now());
    const produce = seededCategoryId(app, 'Produce');
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    const id = await createStore();

    const res = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, {
      payload: {
        name: 'Indian Store',
        iconRef: '🛒',
        sortOrder: 5,
        notes: 'small queues',
        categoryOrder: [dairy, produce],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = storeMutationResponseSchema.parse(res.json());
    expect(body.store.name).toBe('Indian Store');
    expect(body.store.iconRef).toBe('🛒');
    expect(body.store.sortOrder).toBe(5);
    expect(body.store.notes).toBe('small queues');
    expect(body.store.categoryOrder).toEqual([dairy, produce]);
  });

  it('clears notes with null', async () => {
    const id = await createStore();
    await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { notes: 'hi' } });
    const res = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { notes: null } });
    expect(storeMutationResponseSchema.parse(res.json()).store.notes).toBeNull();
  });

  it('rejects unknown category ids in categoryOrder', async () => {
    const id = await createStore();
    const res = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, {
      payload: { categoryOrder: ['not-a-uuid'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown stores with 404', async () => {
    const res = await injectJson(app, 'PATCH', '/api/v1/stores/00000000-0000-7000-8000-000000000001', {
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('store status transitions (§4.6, G1.5)', () => {
  async function createStoreWithItems(bought: number, active: number): Promise<string> {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const id = seedStore(app, householdId, 'Costco', clock.now());
    for (let i = 0; i < bought; i += 1) {
      const item = seedCatalogItem(app, householdId, `Bought ${i}`, clock.now());
      seedListItem(app, { storeId: id, itemId: item, categoryId: cat, status: 'bought', createdAt: clock.now() });
    }
    for (let i = 0; i < active; i += 1) {
      const item = seedCatalogItem(app, householdId, `Active ${i}`, clock.now());
      seedListItem(app, { storeId: id, itemId: item, categoryId: cat, createdAt: clock.now() });
    }
    return id;
  }

  it('POST /stores/:id/done is blocked while active items exist (G1.5)', async () => {
    const id = await createStoreWithItems(2, 1);
    const res = await injectJson(app, 'POST', `/api/v1/stores/${id}/done`);
    expect(res.statusCode).toBe(409);
    expect((errorResponseSchema.parse(res.json()).error as { code: string }).code).toBe(
      'STORE_NOT_EMPTY',
    );
  });

  it('POST /stores/:id/done succeeds with zero active items', async () => {
    const id = await createStoreWithItems(2, 0);
    const res = await injectJson(app, 'POST', `/api/v1/stores/${id}/done`);
    expect(res.statusCode).toBe(200);
    expect(storeMutationResponseSchema.parse(res.json()).store.status).toBe('done');
  });

  it('PATCH status=done is blocked with active items; archived requires zero active too', async () => {
    const id = await createStoreWithItems(1, 1);
    const res = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'done' } });
    expect(res.statusCode).toBe(409);
    const res2 = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'archived' } });
    expect(res2.statusCode).toBe(409);
  });

  it('archived → done is rejected; archived → active restores', async () => {
    const id = await createStoreWithItems(1, 0);
    await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'done' } });
    await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'archived' } });

    const bad = await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'done' } });
    expect(bad.statusCode).toBe(400);

    const reopen = await injectJson(app, 'POST', `/api/v1/stores/${id}/reopen`);
    expect(reopen.statusCode).toBe(200);
    expect(storeMutationResponseSchema.parse(reopen.json()).store.status).toBe('active');
  });

  it('reopen on an active store is a 400', async () => {
    const id = await createStoreWithItems(0, 0);
    const res = await injectJson(app, 'POST', `/api/v1/stores/${id}/reopen`);
    expect(res.statusCode).toBe(400);
  });

  it('done stores and archived stores leave the main board list after archive', async () => {
    const id = await createStoreWithItems(1, 0);
    await injectJson(app, 'POST', `/api/v1/stores/${id}/done`);
    await injectJson(app, 'PATCH', `/api/v1/stores/${id}`, { payload: { status: 'archived' } });
    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const store = board.stores.find((s) => s.id === id);
    expect(store?.status).toBe('archived');
  });
});

describe('DELETE /stores/:id (§7.2 #8)', () => {
  it('is blocked while active items exist, using the copy-deck message', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    seedListItem(app, { storeId, itemId: item, categoryId: cat, createdAt: clock.now() });

    const res = await injectJson(app, 'DELETE', `/api/v1/stores/${storeId}`);
    expect(res.statusCode).toBe(409);
    expect(errorResponseSchema.parse(res.json()).error.message).toBe(
      'This store still has items. Clear them first.',
    );
  });

  it('soft-deletes a store with no active items and hides it from the board', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const item = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    const li = seedListItem(app, { storeId, itemId: item, categoryId: cat, status: 'bought', createdAt: clock.now() });

    const res = await injectJson(app, 'DELETE', `/api/v1/stores/${storeId}`);
    expect(res.statusCode).toBe(200);
    expect(deletedResponseSchema.parse(res.json()).deleted).toBe(true);

    const board = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    expect(board.stores.find((s) => s.id === storeId)).toBeUndefined();

    // Rows remain for history (soft operation).
    const row = app.db.prepare('SELECT status FROM list_items WHERE id = ?').get(li) as {
      status: string;
    };
    expect(row.status).toBe('bought');
    expect(app.db.prepare('SELECT deleted_at FROM stores WHERE id = ?').get(storeId)).toMatchObject({
      deleted_at: expect.any(Number),
    });
  });
});

describe('POST /stores/:id/clear-bought + undo (§6.7, G1.4)', () => {
  it('clears bought rows, keeps active ones, and the round-trip via bulk-check restores them exactly', async () => {
    seedCategories(app.db, clock.now());
    const cat = seededCategoryId(app, 'Produce');
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const boughtIds: string[] = [];
    for (const name of ['Onions', 'Paneer', 'Curd']) {
      const item = seedCatalogItem(app, householdId, name, clock.now());
      boughtIds.push(
        seedListItem(app, { storeId, itemId: item, categoryId: cat, status: 'bought', qty: 1, unit: 'kg', createdAt: clock.now() }),
      );
    }
    const activeItem = seedCatalogItem(app, householdId, 'Tomatoes', clock.now());
    const activeId = seedListItem(app, { storeId, itemId: activeItem, categoryId: cat, qty: 2, unit: 'kg', createdAt: clock.now() });

    const before = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const beforeStore = before.stores.find((s) => s.id === storeId);
    expect(beforeStore?.counts).toEqual({ total: 4, bought: 3 });

    const res = await injectJson(app, 'POST', `/api/v1/stores/${storeId}/clear-bought`);
    expect(res.statusCode).toBe(200);
    expect(clearBoughtResponseSchema.parse(res.json()).cleared).toBe(3);

    const after = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const afterStore = after.stores.find((s) => s.id === storeId);
    expect(afterStore?.counts).toEqual({ total: 1, bought: 0 });
    expect(afterStore?.items.map((i) => i.id)).toEqual([activeId]);

    // Undo: bulk-check checked=true restores the exact same rows to bought.
    const undo = await injectJson(app, 'POST', '/api/v1/list-items/bulk-check', {
      payload: { ids: boughtIds, checked: true },
    });
    expect(undo.statusCode).toBe(200);
    expect((undo.json() as { updated: number }).updated).toBe(3);

    const restored = boardResponseSchema.parse((await injectJson(app, 'GET', '/api/v1/board')).json());
    const restoredStore = restored.stores.find((s) => s.id === storeId);
    expect(restoredStore?.counts).toEqual({ total: 4, bought: 3 });
    expect(new Set(restoredStore?.items.filter((i) => i.status === 'bought').map((i) => i.id))).toEqual(
      new Set(boughtIds),
    );
    expect(restoredStore?.items.find((i) => i.id === activeId)).toMatchObject({ status: 'active', qtyValue: 2 });
  });

  it('is idempotent when there is nothing to clear', async () => {
    const storeId = seedStore(app, householdId, 'Costco', clock.now());
    const res = await injectJson(app, 'POST', `/api/v1/stores/${storeId}/clear-bought`);
    expect(res.statusCode).toBe(200);
    expect(clearBoughtResponseSchema.parse(res.json()).cleared).toBe(0);
  });
});
