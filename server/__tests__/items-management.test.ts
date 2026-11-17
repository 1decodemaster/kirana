import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  aliasMutationResponseSchema,
  deletedResponseSchema,
  errorResponseSchema,
  getItemResponseSchema,
  itemMutationResponseSchema,
  mergeItemsResponseSchema,
  newUuidV7,
} from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import {
  actor,
  buildTestApp,
  FakeClock,
  injectJson,
  seedStore,
} from './helpers.js';

let app: FastifyInstance;
let clock: FakeClock;
let householdId: string;
let storeId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app).householdId;
  seedCategories(app.db, clock.now());
  storeId = seedStore(app, householdId, 'Indian Store', clock.now());
});

afterAll(async () => {
  await app.close();
});

function newClientId(): string {
  return newUuidV7(clock.now());
}

function first<T>(xs: readonly T[]): T {
  const value = xs[0];
  if (value === undefined) throw new Error('expected a non-empty list');
  return value;
}

async function createItem(payload: Record<string, unknown>): Promise<{ status: number; id: string; body: Record<string, unknown> }> {
  const res = await injectJson(app, 'POST', '/api/v1/items', { payload });
  const body = res.json() as { item?: { id: string } };
  return { status: res.statusCode, id: body.item?.id ?? '', body };
}

async function addItem(storeId_: string, itemId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const res = await injectJson(app, 'POST', `/api/v1/stores/${storeId_}/items`, {
    payload: { clientId: newClientId(), itemId, ...extra },
  });
  // 201 = created; 200 = ADR-0007 merge into the store's existing row.
  if (res.statusCode !== 200 && res.statusCode !== 201) throw new Error(`add failed: ${res.body}`);
}

describe('GET /items/:id (ADR-0003, §8.1 item detail)', () => {
  it('returns the full item with aliases and folded usage stats', async () => {
    const { id } = await createItem({ name: 'Basmati Rice', aliases: [{ alias: 'chawal', lang: 'hi' }] });
    await addItem(storeId, id);
    await addItem(storeId, id);
    const otherStore = seedStore(app, householdId, 'Costco', clock.now());
    await addItem(otherStore, id, { qtyValue: 5, unitCode: 'kg' });

    const res = await injectJson(app, 'GET', `/api/v1/items/${id}`);
    expect(res.statusCode).toBe(200);
    const body = getItemResponseSchema.parse(res.json());
    expect(body.item.name).toBe('Basmati Rice');
    expect(body.item.norm).toBe('basmati rice');
    expect(body.item.aliases.map((a) => a.alias)).toContain('chawal');
    expect(body.stats.timesAdded).toBe(3);
    expect(body.stats.storeIds.sort()).toEqual([otherStore, storeId].sort());
  });

  it('404s for unknown and soft-deleted ids', async () => {
    await expect(injectJson(app, 'GET', `/api/v1/items/${newUuidV7(clock.now())}`)).resolves.toMatchObject({ statusCode: 404 });
    const { id } = await createItem({ name: 'Sabun' });
    app.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(clock.now(), id);
    await expect(injectJson(app, 'GET', `/api/v1/items/${id}`)).resolves.toMatchObject({ statusCode: 404 });
  });
});

describe('PATCH /items/:id (§7.2 #18)', () => {
  it('renames, re-normalizes, and keeps the old name findable as an alias', async () => {
    const { id } = await createItem({ name: 'Milk' });
    const res = await injectJson(app, 'PATCH', `/api/v1/items/${id}`, { payload: { name: 'Full Cream Milk' } });
    expect(res.statusCode).toBe(200);
    const body = itemMutationResponseSchema.parse(res.json());
    expect(body.item.name).toBe('Full Cream Milk');
    expect(body.item.norm).toBe('full cream milk');
    expect(body.item.aliases.map((a) => a.alias)).toContain('Milk');

    // the old name still resolves to the same item in search
    const search = await injectJson(app, 'GET', '/api/v1/items?q=milk');
    const found = (search.json() as { items: Array<{ id: string }> }).items.find((i) => i.id === id);
    expect(found).toBeDefined();  });

  it('rejects a rename onto a norm held by another row, deleted or not', async () => {
    const a = await createItem({ name: 'Milk' });
    const b = await createItem({ name: 'Atta' });
    const res = await injectJson(app, 'PATCH', `/api/v1/items/${b.id}`, { payload: { name: 'milk' } });
    expect(res.statusCode).toBe(409);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('CONFLICT_STALE');

    app.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(clock.now(), a.id);
    const ontoDeleted = await injectJson(app, 'PATCH', `/api/v1/items/${b.id}`, { payload: { name: 'Milk' } });
    expect(ontoDeleted.statusCode).toBe(409);
  });

  it('updates defaults and replaces attrs; unknown category is 400', async () => {
    const dairy = (await injectJson(app, 'GET', '/api/v1/categories')).json() as {
      categories: Array<{ id: string; name: string }>;
    };
    const categoryId = dairy.categories.find((c) => c.name === 'Dairy & Eggs')?.id as string;
    const { id } = await createItem({ name: 'Kefir' });

    const ok = await injectJson(app, 'PATCH', `/api/v1/items/${id}`, {
      payload: { defaultCategoryId: categoryId, defaultUnitCode: 'l', defaultQty: 1, attrs: { brand: 'Amul' } },
    });
    const body = itemMutationResponseSchema.parse(ok.json());
    expect(body.item.defaultCategoryId).toBe(categoryId);
    expect(body.item.defaultUnitCode).toBe('l');
    expect(body.item.defaultQty).toBe(1);
    expect(body.item.attrs).toEqual({ brand: 'Amul' });

    const bad = await injectJson(app, 'PATCH', `/api/v1/items/${id}`, {
      payload: { defaultCategoryId: newUuidV7(clock.now()) },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('DELETE /items/:id (§7.2 #19, INV-6)', () => {
  it('soft-deletes and keeps the list row rendering with the item name', async () => {
    const { id } = await createItem({ name: 'Detergent' });
    await addItem(storeId, id);
    const res = await injectJson(app, 'DELETE', `/api/v1/items/${id}`);
    expect(deletedResponseSchema.parse(res.json())).toEqual({ deleted: true });

    await expect(injectJson(app, 'GET', `/api/v1/items/${id}`)).resolves.toMatchObject({ statusCode: 404 });

    // INV-6: the list row survives; the board still serves it (the client
    // renders "Archived item" because the item is gone from the catalog).
    const board = (await injectJson(app, 'GET', '/api/v1/board')).json() as {
      stores: Array<{ items: Array<{ itemId: string; name: string }> }>;
      catalog: Array<{ id: string }>;
    };
    const rows = board.stores.flatMap((s) => s.items).filter((i) => i.itemId === id);
    expect(rows).toHaveLength(1);
    expect(first(rows).name).toBe('Detergent');
    expect(board.catalog.some((c) => c.id === id)).toBe(false);

    // search no longer surfaces it (FTS trigger removed the row)
    const search = await injectJson(app, 'GET', '/api/v1/items?q=detergent');
    expect((search.json() as { items: Array<{ id: string }> }).items).toHaveLength(0);
  });

  it('404s on unknown ids', async () => {
    await expect(
      injectJson(app, 'DELETE', `/api/v1/items/${newUuidV7(clock.now())}`),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});

describe('POST /items/:id/aliases (§7.2 #20)', () => {
  it('creates an alias and makes it resolve in search', async () => {
    const { id } = await createItem({ name: 'Basmati Rice' });
    const res = await injectJson(app, 'POST', `/api/v1/items/${id}/aliases`, {
      payload: { alias: 'chawal', lang: 'hi' },
    });
    expect(res.statusCode).toBe(201);
    const body = aliasMutationResponseSchema.parse(res.json());
    expect(body.alias.alias).toBe('chawal');
    expect(body.alias.lang).toBe('hi');

    const search = await injectJson(app, 'GET', '/api/v1/items?q=chawal');
    const found = (search.json() as { items: Array<{ id: string; matchedVia: string }> }).items.find(
      (i) => i.id === id,
    );
    expect(found?.matchedVia).toBe('alias');
  });

  it('is idempotent for the same norm on the same item (200)', async () => {
    const { id } = await createItem({ name: 'Milk' });
    const first = await injectJson(app, 'POST', `/api/v1/items/${id}/aliases`, {
      payload: { alias: 'doodh', lang: 'hi' },
    });
    const second = await injectJson(app, 'POST', `/api/v1/items/${id}/aliases`, {
      payload: { alias: '  DOODH  ', lang: 'hi' },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { alias: { id: string } }).alias.id).toBe(
      (first.json() as { alias: { id: string } }).alias.id,
    );
  });

  it('rejects an alias equal to the item name (400)', async () => {
    const { id } = await createItem({ name: 'Milk' });
    const res = await injectJson(app, 'POST', `/api/v1/items/${id}/aliases`, {
      payload: { alias: 'milk', lang: 'en' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('409s with a suggestion when the alias collides with another item', async () => {
    const a = await createItem({ name: 'Milk' });
    const b = await createItem({ name: 'Atta' });
    // name collision
    const byName = await injectJson(app, 'POST', `/api/v1/items/${b.id}/aliases`, {
      payload: { alias: 'Milk', lang: 'en' },
    });
    expect(byName.statusCode).toBe(409);
    expect(errorResponseSchema.parse(byName.json()).error.code).toBe('ITEM_NEAR_DUPLICATE');
    // alias collision
    await injectJson(app, 'POST', `/api/v1/items/${a.id}/aliases`, {
      payload: { alias: 'gehu', lang: 'hi' },
    });
    const byAlias = await injectJson(app, 'POST', `/api/v1/items/${b.id}/aliases`, {
      payload: { alias: 'gehu', lang: 'hi' },
    });
    expect(byAlias.statusCode).toBe(409);
  });
});

describe('DELETE /items/:id/aliases/:aliasId (§7.2 #21)', () => {
  it('removes the alias row and its search presence', async () => {
    const { id } = await createItem({ name: 'Milk', aliases: [{ alias: 'doodh', lang: 'hi' }] });
    const detail = getItemResponseSchema.parse((await injectJson(app, 'GET', `/api/v1/items/${id}`)).json());
    const aliasId = first(detail.item.aliases).id;

    const res = await injectJson(app, 'DELETE', `/api/v1/items/${id}/aliases/${aliasId}`);
    expect(deletedResponseSchema.parse(res.json())).toEqual({ deleted: true });

    const after = getItemResponseSchema.parse((await injectJson(app, 'GET', `/api/v1/items/${id}`)).json());
    expect(after.item.aliases).toHaveLength(0);
    const search = await injectJson(app, 'GET', '/api/v1/items?q=doodh');
    expect((search.json() as { items: Array<{ id: string }> }).items).toHaveLength(0);
  });

  it('404s for unknown and foreign alias ids', async () => {
    const a = await createItem({ name: 'Milk', aliases: [{ alias: 'doodh', lang: 'hi' }] });
    const b = await createItem({ name: 'Atta', aliases: [{ alias: 'gehu', lang: 'hi' }] });
    const bAlias = first(
      getItemResponseSchema.parse((await injectJson(app, 'GET', `/api/v1/items/${b.id}`)).json()).item.aliases,
    ).id;

    await expect(
      injectJson(app, 'DELETE', `/api/v1/items/${a.id}/aliases/${newUuidV7(clock.now())}`),
    ).resolves.toMatchObject({ statusCode: 404 });
    await expect(
      injectJson(app, 'DELETE', `/api/v1/items/${a.id}/aliases/${bAlias}`),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});

describe('POST /items/merge (§7.2 #22, G3.5)', () => {
  it('moves list rows and stats, keeps aliases, deletes the source', async () => {
    const source = await createItem({ name: 'Milk 1L', aliases: [{ alias: 'doodh', lang: 'hi' }] });
    const target = await createItem({ name: 'Milk', aliases: [{ alias: 'pal dairy', lang: 'en' }] });
    await addItem(storeId, source.id, { qtyValue: 2 });
    await addItem(storeId, source.id);
    const otherStore = seedStore(app, householdId, 'Costco', clock.now());
    await addItem(otherStore, source.id);
    await addItem(storeId, target.id);

    const res = await injectJson(app, 'POST', '/api/v1/items/merge', {
      payload: { sourceId: source.id, targetId: target.id },
    });
    expect(res.statusCode).toBe(200);
    const body = mergeItemsResponseSchema.parse(res.json());
    expect(body.item.id).toBe(target.id);
    expect(body.item.name).toBe('Milk');
    // source's name survives as a target alias; conflicting-free alias moved
    expect(body.item.aliases.map((a) => a.alias).sort()).toEqual(['Milk 1L', 'doodh', 'pal dairy'].sort());

    await expect(injectJson(app, 'GET', `/api/v1/items/${source.id}`)).resolves.toMatchObject({ statusCode: 404 });

    // Source rows moved to the target, then ADR-0007-consolidated per store:
    // storeId's source row (qty 2) and target's own row fold into one
    // (same-unit group: 2 + null → 2), Costco's row stands alone.
    const board = (await injectJson(app, 'GET', '/api/v1/board')).json() as {
      stores: Array<{ id: string; items: Array<{ itemId: string }> }>;
    };
    const rows = board.stores.flatMap((s) => s.items).filter((i) => i.itemId === target.id);
    expect(rows).toHaveLength(2);
    const detail = getItemResponseSchema.parse((await injectJson(app, 'GET', `/api/v1/items/${target.id}`)).json());
    expect(detail.stats.timesAdded).toBe(4);
    expect(detail.stats.storeIds.sort()).toEqual([otherStore, storeId].sort());
  });

  it('drops an alias the target already has instead of duplicating it', async () => {
    const source = await createItem({ name: 'Curd', aliases: [{ alias: 'dahi', lang: 'hi' }] });
    const target = await createItem({ name: 'Yogurt', aliases: [{ alias: 'dahi', lang: 'hi' }] });
    const res = await injectJson(app, 'POST', '/api/v1/items/merge', {
      payload: { sourceId: source.id, targetId: target.id },
    });
    const body = mergeItemsResponseSchema.parse(res.json());
    expect(body.item.aliases.filter((a) => a.alias === 'dahi')).toHaveLength(1);
    expect(body.item.aliases.map((a) => a.alias)).toContain('Curd');
  });

  it('rejects self-merge (400) and unknown ids (404)', async () => {
    const { id } = await createItem({ name: 'Milk' });
    expect(
      (await injectJson(app, 'POST', '/api/v1/items/merge', { payload: { sourceId: id, targetId: id } })).statusCode,
    ).toBe(400);
    expect(
      (
        await injectJson(app, 'POST', '/api/v1/items/merge', {
          payload: { sourceId: newUuidV7(clock.now()), targetId: id },
        })
      ).statusCode,
    ).toBe(404);
  });
});
