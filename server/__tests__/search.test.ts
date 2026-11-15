import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getItemsResponseSchema, newUuidV7 } from '@kirana/shared';
import { seedCategories, seedHouseholdCatalog } from '@kirana/db';
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
let otherStoreId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app, clock).householdId;
  seedCategories(app.db, clock.now());
  seedHouseholdCatalog(app.db, householdId, clock.now());
  storeId = seedStore(app, householdId, 'Indian Store', clock.now());
  otherStoreId = seedStore(app, householdId, 'Big Bazaar', clock.now());
});

afterAll(async () => {
  await app.close();
});

async function search(query: string): Promise<{ status: number; body: ReturnType<typeof getItemsResponseSchema.parse> }> {
  const res = await injectJson(app, 'GET', `/api/v1/items?q=${encodeURIComponent(query)}`);
  return { status: res.statusCode, body: res.json() };
}

describe('GET /items — G2.4 mandated queries', () => {
  const cases: Array<[string, string]> = [
    ['pya', 'Onion'],
    ['pyaz', 'Onion'],
    ['प्याज़', 'Onion'],
    ['chawa', 'Basmati Rice'],
    ['dood', 'Milk'],
    ['milk', 'Milk'],
  ];
  for (const [q, expected] of cases) {
    it(`"${q}" → ${expected}`, async () => {
      const { status, body } = await search(q);
      expect(status).toBe(200);
      expect(body.items[0]?.name).toBe(expected);
    });
  }

  it('Hinglish fold variants reach the same item', async () => {
    const { body } = await search('pyaj');
    expect(body.items[0]?.name).toBe('Onion');
  });

  it('mid-word substrings surface via the trigram tier', async () => {
    const { body } = await search('ilk');
    expect(body.items[0]?.name).toBe('Milk');
    expect(body.items[0]?.matchedVia).toBe('name');
  });

  it('typos surface via the edit-distance tier', async () => {
    const { body } = await search('mlk');
    expect(body.items[0]?.name).toBe('Milk');
    expect(body.items[0]?.matchedVia).toBe('fuzzy');
  });

  it('junk queries return no items', async () => {
    const { body } = await search('zzzz');
    expect(body.items).toEqual([]);
  });
});

describe('GET /items — contract and metadata', () => {
  it('always satisfies the frozen response schema', async () => {
    const { body } = await search('milk');
    expect(() => getItemsResponseSchema.parse(body)).not.toThrow();
  });

  it('reports matchedVia name for exact and prefix name hits, alias for aliases', async () => {
    expect((await search('milk')).body.items[0]?.matchedVia).toBe('name');
    expect((await search('pyaz')).body.items[0]?.matchedVia).toBe('alias');
    expect((await search('dood')).body.items[0]?.matchedVia).toBe('alias');
  });

  it('marks inStore against the requested store only', async () => {
    const milkId = (await search('milk')).body.items[0]?.id as string;
    const add = async (store: string): Promise<unknown> =>
      injectJson(app, 'POST', `/api/v1/stores/${store}/items`, {
        payload: { clientId: newUuidV7(clock.now()), itemId: milkId },
      });
    await add(storeId);

    const inStore = await injectJson(app, 'GET', `/api/v1/items?q=milk&storeId=${storeId}`);
    const notInStore = await injectJson(app, 'GET', `/api/v1/items?q=milk&storeId=${otherStoreId}`);
    expect(inStore.json().items[0]?.inStore).toBe(true);
    expect(notInStore.json().items[0]?.inStore).toBe(false);
    expect((await search('milk')).body.items[0]?.inStore).toBe(false);
  });

  it('ranks frequently-added items above equally-matching ones', async () => {
    // 'dal' substring-matches Toor Dal, Chana Dal and Moong Dal at the same
    // 0.70 tier; the one with 25 adds must come out on top.
    for (let i = 0; i < 25; i++) {
      const toor = (await search('toor dal')).body.items[0]?.id as string;
      await injectJson(app, 'POST', `/api/v1/stores/${storeId}/items`, {
        payload: { clientId: newUuidV7(clock.now()), itemId: toor },
      });
    }
    const { body } = await search('dal');
    expect(body.items[0]?.name).toBe('Toor Dal');
    const scores = body.items.map((i) => i.score);
    expect(scores[0]).toBeGreaterThan(scores[1] ?? 0);
  });
});

describe('GET /items — pagination and browse', () => {
  it('paginates with limit and cursor', async () => {
    const page1 = await injectJson(app, 'GET', '/api/v1/items?limit=5');
    const parsed = getItemsResponseSchema.parse(page1.json());
    expect(parsed.items).toHaveLength(5);
    expect(parsed.nextCursor).toBeDefined();
    const page2 = await injectJson(app, 'GET', `/api/v1/items?limit=5&cursor=${parsed.nextCursor}`);
    const parsed2 = getItemsResponseSchema.parse(page2.json());
    expect(parsed2.items[0]?.id).not.toBe(parsed.items[0]?.id);
  });

  it('browses the whole catalog ordered by name_norm when q is absent', async () => {
    const all = await injectJson(app, 'GET', '/api/v1/items?limit=200');
    const items = getItemsResponseSchema.parse(all.json()).items;
    expect(items.length).toBe(40); // §14.2 seed size
    const norms = items.map((i) => i.norm);
    expect([...norms].sort()).toEqual(norms);
  });

  it('filters by categoryId in both browse and search modes', async () => {
    const dairy = (
      app.db.prepare("SELECT id FROM categories WHERE name = 'Dairy & Eggs'").get() as { id: string }
    ).id;
    const browse = await injectJson(app, 'GET', `/api/v1/items?categoryId=${dairy}`);
    const names = (browse.json().items as Array<{ name: string }>).map((i) => i.name);
    expect(names).toContain('Milk');
    expect(names).not.toContain('Onion');

    const searched = await injectJson(app, 'GET', `/api/v1/items?q=milk&categoryId=${dairy}`);
    expect((searched.json().items as Array<{ name: string }>).map((i) => i.name)).toContain('Milk');
    const wrongCategory = await injectJson(app, 'GET', `/api/v1/items?q=milk&categoryId=${otherCategoryId(app)}`);
    expect((wrongCategory.json().items as Array<{ name: string }>)).toHaveLength(0);
  });

  it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/items?cursor=not-a-number');
    expect(res.statusCode).toBe(400);
  });

  it('excludes soft-deleted items from search and browse', async () => {
    const rice = (await search('basmati')).body.items[0] as { id: string };
    app.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(clock.now(), rice.id);
    expect((await search('basmati')).body.items).toEqual([]);
    const browse = await injectJson(app, 'GET', '/api/v1/items?limit=200');
    expect((browse.json().items as Array<{ id: string }>).some((i) => i.id === rice.id)).toBe(false);
  });
});

function otherCategoryId(app: FastifyInstance): string {
  return (
    app.db.prepare("SELECT id FROM categories WHERE name = 'Produce' AND deleted_at IS NULL").get() as {
      id: string;
    }
  ).id;
}
