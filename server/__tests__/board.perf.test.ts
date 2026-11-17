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

// G1.2: board p95 ≤ 50ms with the 2k-item fixture.
// 10 stores × 200 list rows, deterministic mix of active/bought.

const STORES = 10;
const ITEMS_PER_STORE = 200;
const RUNS = 60;
const WARMUP = 10;

let app: FastifyInstance;

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

  app.db.transaction(() => {
    let n = 0;
    for (let s = 0; s < STORES; s += 1) {
      const storeId = seedStore(app, householdId, `Store ${s}`, clock.now());
      for (let i = 0; i < ITEMS_PER_STORE; i += 1) {
        const itemId = newUuidV7(1_730_000_000_000 + n);
        insertItem.run(
          itemId,
          householdId,
          `Item ${n}`,
          `item ${n}`,
          categories[n % categories.length],
          1_730_000_000_000,
          1_730_000_000_000,
        );
        const bought = n % 3 === 0;
        insertListRow.run(
          newUuidV7(1_730_000_100_000 + n),
          storeId,
          itemId,
          (n % 5) + 1,
          categories[n % categories.length],
          bought ? 'bought' : 'active',
          bought ? 1_730_000_200_000 : null,
          n % 7,
          1_730_000_000_000 + n,
          1_730_000_000_000 + n,
        );
        n += 1;
      }
    }
  })();
});

afterAll(async () => {
  await app.close();
});

describe('G1.2 — board performance with the 2k-item fixture', () => {
  it('GET /board responds with p95 ≤ 50ms', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/board');
    expect(res.statusCode).toBe(200);
    const board = res.json() as { stores: Array<{ items: unknown[] }> };
    const totalItems = board.stores.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalItems).toBe(STORES * ITEMS_PER_STORE);

    for (let i = 0; i < WARMUP; i += 1) {
      await injectJson(app, 'GET', '/api/v1/board');
    }
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const start = performance.now();
      const run = await injectJson(app, 'GET', '/api/v1/board');
      samples.push(performance.now() - start);
      expect(run.statusCode).toBe(200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    // Serialization of the ~2k-row payload dominates; the builder itself must
    // stay well under the gate. Assert the gate on the injected round-trip.
    expect(p95).toBeLessThanOrEqual(50);
  });
});
