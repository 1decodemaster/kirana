import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addListItemResponseSchema,
  errorResponseSchema,
  itemMutationResponseSchema,
  newUuidV7,
} from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import {
  actor,
  buildTestApp,
  FakeClock,
  injectJson,
  seededCategoryId,
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

interface Added {
  readonly status: number;
  readonly body: {
    listItem: { id: string; itemId: string; name: string; qtyValue: number | null; unitCode: string | null; categoryId: string | null; status: string; note: string | null };
    item: { id: string; name: string; norm: string; aliases: readonly string[]; defaultUnit: string | null; defaultCategoryId: string | null; iconRef: string | null };
    createdItem: boolean;
    createdAlias: boolean;
  };
}

async function add(payload: Record<string, unknown>, target = storeId): Promise<Added> {
  const res = await injectJson(app, 'POST', `/api/v1/stores/${target}/items`, { payload });
  return { status: res.statusCode, body: res.json() };
}

describe('POST /stores/:id/items — known items (§7.4)', () => {
  it('adds by itemId without touching the catalog', async () => {
    const created = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l' });
    expect(created.status).toBe(201);
    expect(created.body.createdItem).toBe(true);
    const again = await add({ clientId: newClientId(clock), itemId: created.body.item.id, qtyValue: 1 });
    // ADR-0007: the add lands on the store's existing active row → merge.
    expect(again.status).toBe(200);
    expect(again.body.createdItem).toBe(false);
    expect(again.body.createdAlias).toBe(false);
    expect(again.body.listItem.id).toBe(created.body.listItem.id);
    expect(again.body.listItem.itemId).toBe(created.body.item.id);
    expect(again.body.listItem.name).toBe('Milk');
    expect(again.body.listItem.qtyValue).toBe(3);
  });

  it('resolves an alias to the existing item (no duplicate)', async () => {
    const made = await injectJson(app, 'POST', '/api/v1/items', {
      payload: { name: 'Milk', aliases: [{ alias: 'doodh', lang: 'en' }] },
    });
    expect(made.statusCode).toBe(201);
    const viaAlias = await add({ clientId: newClientId(clock), name: 'doodh' });
    expect(viaAlias.status).toBe(201);
    expect(viaAlias.body.createdItem).toBe(false);
    expect(viaAlias.body.item.id).toBe(made.json().item.id);
    expect(viaAlias.body.item.name).toBe('Milk');
  });

  it('the response satisfies the frozen contract (G2.1 shape)', async () => {
    const { body } = await add({ clientId: newClientId(clock), name: 'Atta', qtyValue: 5, unitCode: 'kg' });
    expect(() => addListItemResponseSchema.parse(body)).not.toThrow();
  });

  it('rejects an unknown itemId, unknown store, and unknown category', async () => {
    expect((await add({ clientId: newClientId(clock), itemId: '01913b5e-7d5a-7000-8000-0000000000ff' })).status).toBe(404);
    expect((await add({ clientId: newClientId(clock), name: 'Milk' }, '01913b5e-7d5a-7000-8000-0000000000fe')).status).toBe(404);
    const bad = await add({
      clientId: newClientId(clock),
      name: 'Milk',
      categoryId: '01913b5e-7d5a-7000-8000-0000000000fd',
    });
    expect(bad.status).toBe(400);
    expect(errorResponseSchema.parse(bad.body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /stores/:id/items — new items (§6.4 step 5, §6.5)', () => {
  it('creates one item + one alias with hint-derived category and icon', async () => {
    const { body } = await add({ clientId: newClientId(clock), name: 'Parle-G Biscuits' });
    expect(body.createdItem).toBe(true);
    expect(body.createdAlias).toBe(true);
    expect(body.item.name).toBe('Parle-G Biscuits');
    expect(body.item.norm).toBe('parle-g biscuits');
    expect(body.item.aliases).toContain('Parle-G Biscuits');
    expect(body.item.defaultCategoryId).toBe(seededCategoryId(app, 'Snacks & Namkeen'));
    expect(body.item.iconRef).not.toBe('🛒'); // category icon, not the fallback
    expect(body.listItem.categoryId).toBe(seededCategoryId(app, 'Snacks & Namkeen'));
  });

  it('falls back to Other when no hint matches', async () => {
    const { body } = await add({ clientId: newClientId(clock), name: 'Qzxw Vut' });
    expect(body.item.defaultCategoryId).toBe(seededCategoryId(app, 'Other'));
  });

  it('keeps the typed unit as the item default and reuses it next time', async () => {
    const first = await add({ clientId: newClientId(clock), name: 'Rice', qtyValue: 5, unitCode: 'kg' });
    expect(first.body.item.defaultUnit).toBe('kg');
    const second = await add({ clientId: newClientId(clock), name: 'Rice' });
    expect(second.body.createdItem).toBe(false);
    // ADR-0007: the quantity-less add merges into the row — the existing
    // quantity stands; nothing is invented.
    expect(second.body.listItem.qtyValue).toBe(5);
  });

  it('reuses the store-scoped category on the next add (§6.5 order)', async () => {
    const dairy = seededCategoryId(app, 'Dairy & Eggs');
    await add({ clientId: newClientId(clock), name: 'Kefir', categoryId: dairy });
    const second = await add({ clientId: newClientId(clock), name: 'Kefir' });
    expect(second.body.listItem.categoryId).toBe(dairy);
  });

  it('revives a soft-deleted item instead of violating INV-5', async () => {
    const { body } = await add({ clientId: newClientId(clock), name: 'Sabun' });
    const itemId = body.item.id;
    app.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(clock.now(), itemId);
    const revived = await add({ clientId: newClientId(clock), name: 'Sabun' });
    // The revived add lands on the surviving (INV-6) active row → merge.
    expect(revived.status).toBe(200);
    expect(revived.body.item.id).toBe(itemId);
    const count = app.db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND name_norm = ?')
      .get(householdId, 'sabun') as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('POST /stores/:id/items — idempotency and dedupe gates', () => {
  it('replaying a clientId returns the original row with 200 (§7.4)', async () => {
    const clientId = newClientId(clock);
    const first = await add({ clientId, name: 'Milk', qtyValue: 2 });
    expect(first.status).toBe(201);
    const replay = await add({ clientId, name: 'Milk', qtyValue: 99 });
    expect(replay.status).toBe(200);
    expect(replay.body.listItem.id).toBe(first.body.listItem.id);
    expect(replay.body.listItem.qtyValue).toBe(2);
    expect(replay.body.createdItem).toBe(false);
  });

  it('G2.3: adding the same name 100× creates exactly 1 item and 1 alias (and, since ADR-0007, 1 row)', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await add({ clientId: newClientId(clock), name: 'Toor Dal' });
      expect(res.status).toBe(i === 0 ? 201 : 200);
    }
    const items = app.db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND name_norm = ?')
      .get(householdId, 'toor dal') as { n: number };
    const aliases = app.db
      .prepare(
        `SELECT COUNT(*) AS n FROM item_aliases a JOIN items i ON i.id = a.item_id
         WHERE i.household_id = ? AND i.name_norm = ?`,
      )
      .get(householdId, 'toor dal') as { n: number };
    const rows = app.db
      .prepare(
        `SELECT COUNT(*) AS n FROM list_items li JOIN items i ON i.id = li.item_id
         WHERE li.store_id = ? AND i.name_norm = ? AND li.status = 'active'`,
      )
      .get(storeId, 'toor dal') as { n: number };
    expect(items.n).toBe(1);
    expect(aliases.n).toBe(1);
    expect(rows.n).toBe(1);
  });

  it('a deleted row frees its clientId for the undo re-add (BACKLOG P2)', async () => {
    const clientId = newClientId(clock);
    const { body } = await add({ clientId, name: 'Milk' });
    const del = await injectJson(app, 'DELETE', `/api/v1/list-items/${body.listItem.id}`);
    expect(del.statusCode).toBe(200);
    const undoToken = del.json().undoToken as string;
    const reAdd = await add({ clientId: undoToken, itemId: body.item.id });
    expect(reAdd.status).toBe(201);
    const rows = app.db
      .prepare('SELECT COUNT(*) AS n FROM list_items WHERE store_id = ?')
      .get(storeId) as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('G2.5 — near-duplicates never auto-create (§6.4 step 4)', () => {
  async function addFrequently(name: string, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await add({ clientId: newClientId(clock), name });
    }
  }

  it('a fuzzy add of a store staple returns 409 with suggestions, no second row', async () => {
    await addFrequently('Basmati Rice', 20);
    const before = itemCount('basmati rice');
    const res = await add({ clientId: newClientId(clock), name: 'basmati ri' });
    expect(res.status).toBe(409);
    const error = errorResponseSchema.parse(res.body).error;
    expect(error.code).toBe('ITEM_NEAR_DUPLICATE');
    const suggestions = error.details?.suggestions as Array<{ id: string; name: string; score: number }>;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.name).toBe('Basmati Rice');
    expect(suggestions[0]?.score).toBeGreaterThanOrEqual(0.9);
    expect(itemCount('basmati rice')).toBe(before);
    expect(itemCount('basmati ri')).toBe(0);
  });

  it('an unrelated new name still creates freely', async () => {
    await addFrequently('Basmati Rice', 20);
    const res = await add({ clientId: newClientId(clock), name: 'Dish Sponge' });
    expect(res.status).toBe(201);
    expect(res.body.createdItem).toBe(true);
  });

  it('the near-duplicate threshold needs the §8.6 signals, not just a prefix', async () => {
    // 'Basmati Rice' exists but was never added: 0.85 prefix + zero signals
    // = 0.4675 < 0.90, so a similarly-prefixed name may be created.
    await injectJson(app, 'POST', '/api/v1/items', { payload: { name: 'Basmati Rice' } });
    const res = await add({ clientId: newClientId(clock), name: 'basmati ri' });
    expect(res.status).toBe(201);
  });
});

describe('POST /items — create catalog item (sheet "Create new anyway")', () => {
  it('creates an item with defaults and aliases', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/items', {
      payload: {
        name: 'Jaggery',
        defaultUnitCode: 'g',
        aliases: [{ alias: 'gur', lang: 'en' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const parsed = itemMutationResponseSchema.parse(res.json());
    expect(parsed.item.name).toBe('Jaggery');
    expect(parsed.item.defaultUnitCode).toBe('g');
    expect(parsed.item.aliases.map((a) => a.alias)).toContain('gur');
  });

  it('returns the existing item with 200 when the norm already exists', async () => {
    const first = await injectJson(app, 'POST', '/api/v1/items', { payload: { name: 'Jaggery' } });
    expect(first.statusCode).toBe(201);
    const second = await injectJson(app, 'POST', '/api/v1/items', { payload: { name: 'jaggery ' } });
    expect(second.statusCode).toBe(200);
    expect(second.json().item.id).toBe(first.json().item.id);
  });

  it('rejects an unknown defaultCategoryId', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/items', {
      payload: { name: 'Jaggery', defaultCategoryId: '01913b5e-7d5a-7000-8000-0000000000fc' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('ADR-0007 — accumulation within a store', () => {
  it('re-adding the same item sums quantities into one row (200, stats +1, change_log update)', async () => {
    const first = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l' });
    expect(first.status).toBe(201);
    const before = app.db.prepare('SELECT COALESCE(MAX(id), 0) AS rev FROM change_log').get() as { rev: number };
    const second = await add({ clientId: newClientId(clock), name: 'milk', qtyValue: 1, unitCode: 'l' });
    expect(second.status).toBe(200);
    expect(second.body.listItem.id).toBe(first.body.listItem.id);
    expect(second.body.listItem.qtyValue).toBe(3);

    const rows = app.db
      .prepare(
        `SELECT COUNT(*) AS n FROM list_items li JOIN items i ON i.id = li.item_id
         WHERE li.store_id = ? AND i.name_norm = ? AND li.status = 'active'`,
      )
      .get(storeId, 'milk') as { n: number };
    expect(rows.n).toBe(1);

    const stats = app.db
      .prepare('SELECT times_added FROM item_store_stats WHERE item_id = ? AND store_id = ?')
      .get(first.body.item.id, storeId) as { times_added: number };
    expect(stats.times_added).toBe(2);

    const entries = app.db
      .prepare('SELECT entity, op FROM change_log WHERE id > ?')
      .all(before.rev) as Array<{ entity: string; op: string }>;
    expect(entries.map((e) => `${e.entity}:${e.op}`)).toEqual(['list_item:update']);
  });

  it('a bought row never merges — re-adding after buying makes a new row', async () => {
    const first = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l' });
    await injectJson(app, 'PATCH', `/api/v1/list-items/${first.body.listItem.id}`, {
      payload: { status: 'bought' },
    });
    const second = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 1, unitCode: 'l' });
    expect(second.status).toBe(201);
    expect(second.body.listItem.id).not.toBe(first.body.listItem.id);
    const rows = app.db
      .prepare('SELECT COUNT(*) AS n FROM list_items WHERE store_id = ? AND item_id = ?')
      .get(storeId, first.body.item.id) as { n: number };
    expect(rows.n).toBe(2);
  });

  it('an explicitly different unit with a quantity replaces the row\u2019s qty/unit', async () => {
    const first = await add({ clientId: newClientId(clock), name: 'Rice', qtyValue: 2, unitCode: 'l' });
    const second = await add({ clientId: newClientId(clock), name: 'Rice', qtyValue: 1, unitCode: 'kg' });
    expect(second.status).toBe(200);
    expect(second.body.listItem.qtyValue).toBe(1);
    expect(second.body.listItem.unitCode).toBe('kg');
    expect(second.body.listItem.id).toBe(first.body.listItem.id);
  });

  it('an add without qty or unit leaves the row untouched but still counts the add', async () => {
    const first = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l' });
    const second = await add({ clientId: newClientId(clock), name: 'Milk' });
    expect(second.status).toBe(200);
    expect(second.body.listItem.qtyValue).toBe(2);
    const stats = app.db
      .prepare('SELECT times_added FROM item_store_stats WHERE item_id = ? AND store_id = ?')
      .get(first.body.item.id, storeId) as { times_added: number };
    expect(stats.times_added).toBe(2);
  });

  it('different stores keep separate rows for the same item', async () => {
    const otherStore = seedStore(app, householdId, 'Costco', clock.now());
    const first = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l' });
    const other = await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 1, unitCode: 'l' }, otherStore);
    expect(other.status).toBe(201);
    expect(other.body.listItem.id).not.toBe(first.body.listItem.id);
    expect(other.body.listItem.itemId).toBe(first.body.item.id);
  });

  it('an explicitly provided note or category replaces the merged row\u2019s', async () => {
    await add({ clientId: newClientId(clock), name: 'Milk', qtyValue: 2, unitCode: 'l', note: 'full cream' });
    const categoryId = seededCategoryId(app, 'Dairy & Eggs');
    const second = await add({
      clientId: newClientId(clock),
      name: 'Milk',
      note: 'toned',
      categoryId,
    });
    expect(second.status).toBe(200);
    expect(second.body.listItem.note).toBe('toned');
    expect(second.body.listItem.categoryId).toBe(categoryId);
    expect(second.body.listItem.qtyValue).toBe(2);
  });
});

describe('stats and change log side effects', () => {
  it('bumps item_store_stats (INV-8) and ships the signals on the board', async () => {
    await add({ clientId: newClientId(clock), name: 'Milk' });
    await add({ clientId: newClientId(clock), name: 'Milk' });
    const stats = app.db
      .prepare('SELECT times_added, last_added_at FROM item_store_stats WHERE item_id = ? AND store_id = ?')
      .get(
        (app.db.prepare('SELECT id FROM items WHERE name_norm = ?').get('milk') as { id: string }).id,
        storeId,
      ) as { times_added: number; last_added_at: number };
    expect(stats.times_added).toBe(2);

    const board = await injectJson(app, 'GET', '/api/v1/board');
    const milk = (board.json().catalog as Array<{ name: string; stats?: { timesAdded: number; storeIds: string[] } }>).find(
      (c) => c.name === 'Milk',
    );
    expect(milk?.stats).toBeDefined();
    expect(milk?.stats?.timesAdded).toBe(2);
    expect(milk?.stats?.storeIds).toContain(storeId);
  });

  it('catalog-only items carry no stats on the board', async () => {
    await injectJson(app, 'POST', '/api/v1/items', { payload: { name: 'Jaggery' } });
    const board = await injectJson(app, 'GET', '/api/v1/board');
    const jaggery = (board.json().catalog as Array<{ name: string; stats?: unknown }>).find(
      (c) => c.name === 'Jaggery',
    );
    expect(jaggery?.stats).toBeUndefined();
  });

  it('appends item, alias and list_item change_log entries on a fresh add', async () => {
    const before = app.db.prepare('SELECT COALESCE(MAX(id), 0) AS rev FROM change_log').get() as { rev: number };
    await add({ clientId: newClientId(clock), name: 'Cumin Seeds' });
    const entries = app.db
      .prepare('SELECT entity, op FROM change_log WHERE id > ? ORDER BY id')
      .all(before.rev) as Array<{ entity: string; op: string }>;
    expect(entries.map((e) => `${e.entity}:${e.op}`)).toEqual(
      expect.arrayContaining(['item:create', 'alias:create', 'list_item:create']),
    );
  });
});

function newClientId(clock: FakeClock): string {
  return newUuidV7(clock.now());
}

function itemCount(norm: string): number {
  return (
    app.db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL')
      .get(householdId, norm) as { n: number }
  ).n;
}
