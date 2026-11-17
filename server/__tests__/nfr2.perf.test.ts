import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newUuidV7 } from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import {
  actor,
  buildTestApp,
  FakeClock,
  injectJson,
  seededCategoryId,
  seedStore,
} from './helpers.js';

// NFR-2: any API p95 ≤ 100ms at the §10 scale (2,000 items / 500 list rows).
// Samples every read endpoint plus one mutation (the ADR-0007 merge path)
// and asserts each endpoint's p95 individually.

const STORES = 10;
const ITEMS = 2000;
const LIST_ROWS = 500; // items where n % 4 === 0 — asserted below via the board
const RUNS = 15;
const WARMUP = 3;
const BUDGET_MS = 100;

let app: FastifyInstance;
let firstItemId: string;
let mergeStoreId: string;

beforeAll(async () => {
  app = await buildTestApp();
  const clock = new FakeClock();
  const householdId = actor(app).householdId;
  seedCategories(app.db, clock.now());
  const categories = [
    seededCategoryId(app, 'Produce'),
    seededCategoryId(app, 'Dairy & Eggs'),
    seededCategoryId(app, 'Grains & Lentils'),
    seededCategoryId(app, 'Snacks & Namkeen'),
    seededCategoryId(app, 'Beverages & Tea/Coffee'),
  ];

  const insertItem = app.db.prepare(
    `INSERT INTO items (id, household_id, name, name_norm, default_category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertListRow = app.db.prepare(
    `INSERT INTO list_items (id, store_id, item_id, qty_value, unit_code, category_id,
            status, checked_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'kg', ?, ?, ?, ?, ?, ?)`,
  );

  const storeIds: string[] = [];
  app.db.transaction(() => {
    for (let s = 0; s < STORES; s += 1) {
      storeIds.push(seedStore(app, householdId, `Store ${s}`, clock.now()));
    }
    const cat = (n: number): string => {
      const c = categories[n % categories.length];
      if (c === undefined) throw new Error('fixture index out of range');
      return c;
    };
    const store = (n: number): string => {
      const s = storeIds[(n / 4) % STORES];
      if (s === undefined) throw new Error('fixture index out of range');
      return s;
    };
    for (let n = 0; n < ITEMS; n += 1) {
      const itemId = newUuidV7(1_730_000_000_000 + n);
      insertItem.run(
        itemId,
        householdId,
        `Item ${n}`,
        `item ${n}`,
        cat(n),
        1_730_000_000_000,
        1_730_000_000_000,
      );
      if (n % 4 === 0) {
        const bought = n % 3 === 0;
        insertListRow.run(
          newUuidV7(1_730_000_100_000 + n),
          store(n),
          itemId,
          (n % 5) + 1,
          cat(n),
          bought ? 'bought' : 'active',
          bought ? 1_730_000_200_000 : null,
          n % 7,
          1_730_000_000_000 + n,
          1_730_000_000_000 + n,
        );
      }
    }
  })();

  firstItemId = (
    app.db.prepare('SELECT id FROM items ORDER BY created_at LIMIT 1').get() as { id: string }
  ).id;
  // Item 4 sits as an active row in store (4/4)%10 = 1 — the merge path.
  const mergeTarget = storeIds[1];
  if (mergeTarget === undefined) throw new Error('fixture index out of range');
  mergeStoreId = mergeTarget;
});

afterAll(async () => {
  await app.close();
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (p === undefined) throw new Error('no samples');
  return p;
}

describe('NFR-2 — any API p95 ≤ 100ms with the 2k-item fixture', () => {
  it('every sampled endpoint answers with p95 ≤ 100ms', async () => {
    // The fixture is what the budget assumes — assert its shape first.
    const boardRes = await injectJson(app, 'GET', '/api/v1/board');
    expect(boardRes.statusCode).toBe(200);
    const board = boardRes.json() as { stores: Array<{ items: unknown[] }> };
    expect(board.stores.reduce((sum, s) => sum + s.items.length, 0)).toBe(LIST_ROWS);

    const mergeTarget = mergeStoreId;
    const mix: ReadonlyArray<{ readonly name: string; readonly call: () => Promise<unknown> }> = [
      { name: 'GET /board', call: () => injectJson(app, 'GET', '/api/v1/board') },
      { name: 'GET /auth/me', call: () => injectJson(app, 'GET', '/api/v1/auth/me') },
      { name: 'GET /categories', call: () => injectJson(app, 'GET', '/api/v1/categories') },
      {
        name: 'GET /items?q=item 12',
        call: () => injectJson(app, 'GET', `/api/v1/items?q=${encodeURIComponent('item 12')}`),
      },
      { name: 'GET /items/:id', call: () => injectJson(app, 'GET', `/api/v1/items/${firstItemId}`) },
      {
        name: 'GET /export?format=json',
        call: () => injectJson(app, 'GET', '/api/v1/export?format=json'),
      },
      {
        name: 'POST /stores/:id/items (merge)',
        // Fixed clientId: run 1 merges, runs 2+ are deterministic replays.
        call: () =>
          injectJson(app, 'POST', `/api/v1/stores/${mergeTarget}/items`, {
            payload: { clientId: '01913b5e-7d5a-7000-8000-000000000001', name: 'Item 4' },
          }),
      },
    ];

    const lines: string[] = [];
    let worst = 0;
    for (const endpoint of mix) {
      for (let i = 0; i < WARMUP; i += 1) await endpoint.call();
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const start = performance.now();
        const res = (await endpoint.call()) as { statusCode: number };
        samples.push(performance.now() - start);
        expect(res.statusCode).toBe(200);
      }
      const p = p95(samples);
      worst = Math.max(worst, p);
      lines.push(`${endpoint.name.padEnd(32)} p95 ${p.toFixed(1)}ms`);
    }
    console.info(`NFR-2 sampled (RUNS=${RUNS}):\n${lines.join('\n')}\nworst p95: ${worst.toFixed(1)}ms`);
    expect(worst).toBeLessThanOrEqual(BUDGET_MS);
  });
});
