import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { exportPayloadSchema, newUuidV7 } from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import { actor, buildTestApp, FakeClock, injectJson, seedCatalogItem, seedListItem, seedStore } from './helpers.js';
import { exportJson, exportStoreCsv, EXPORT_SCHEMA_VERSION } from '../services/export.js';
import { commitImport } from '../services/importCommit.js';
import { previewImport } from '../services/importPreview.js';
import { issuePreviewToken } from '../services/importToken.js';
import { parseCsvImport, parseJsonImport } from '../services/importParse.js';

let app: FastifyInstance;
let clock: FakeClock;
let householdId: string;
let storeId: string;
let otherStoreId: string;
let riceId: string;
let dalId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  householdId = actor(app).householdId;
  seedCategories(app.db, clock.now());
  storeId = seedStore(app, householdId, 'Indian Store', clock.now());
  otherStoreId = seedStore(app, householdId, 'Costco', clock.now());
  riceId = seedCatalogItem(app, householdId, 'Basmati Rice', clock.now(), { unit: 'kg' });
  dalId = seedCatalogItem(app, householdId, 'Toor Dal', clock.now(), { unit: 'kg' });
  app.db
    .prepare(`INSERT INTO item_aliases (id, item_id, alias, alias_norm, search_key, lang, source, created_at)
              VALUES (?, ?, 'chawal', 'chawal', 'c', 'en', 'user', ?)`)
    .run(newUuidV7(clock.now()), riceId, clock.now());
  seedListItem(app, { storeId, itemId: riceId, qty: 5, unit: 'kg', createdAt: clock.now() });
  seedListItem(app, { storeId, itemId: dalId, status: 'bought', note: 'a, "rich" note', createdAt: clock.now() });
  seedListItem(app, { storeId: otherStoreId, itemId: dalId, qty: 1, unit: 'kg', createdAt: clock.now() });
});

afterAll(async () => {
  await app.close();
});

describe('exportJson (§9.4)', () => {
  it('dumps household, categories, stores, items and all list rows', () => {
    const payload = exportJson(app.db, householdId, 1_730_000_000_000);
    // Contract-validated on the way out.
    expect(() => exportPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(payload.exportedAt).toBe(1_730_000_000_000);
    expect(payload.stores.map((s) => s.name)).toEqual(['Indian Store', 'Costco']);
    expect(payload.items.map((i) => i.name)).toEqual(['Basmati Rice', 'Toor Dal']);
    expect(payload.items[0]?.aliases.map((a) => a.alias)).toEqual(['chawal']);
    // stores[].items is the board view (active+bought): 2 rows on Indian Store, 1 on Costco.
    expect(payload.stores[0]?.items).toHaveLength(2);
    expect(payload.stores[1]?.items).toHaveLength(1);
    // listItems is the complete dump (any status).
    expect(payload.listItems).toHaveLength(3);
    expect(payload.listItems.every((li) => typeof li.storeId === 'string')).toBe(true);

    // Cleared history is exported too (the complete dump), though the CSV
    // format cannot carry it.
    const clearedId = seedListItem(app, { storeId: otherStoreId, itemId: riceId, createdAt: clock.now() });
    app.db.prepare("UPDATE list_items SET status = 'cleared' WHERE id = ?").run(clearedId);
    expect(exportJson(app.db, householdId, 1_730_000_000_001).listItems).toHaveLength(4);
  });

  it('serves GET /export as JSON by default', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/export');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: number; household: { name: string } };
    expect(body.household.name).toBe('Home');
  });

  it('404s for an unknown CSV store and 400s for csv without storeId', async () => {
    const missing = await injectJson(app, 'GET', `/api/v1/export?format=csv&storeId=${newUuidV7(clock.now())}`);
    expect(missing.statusCode).toBe(404);
    const noStore = await injectJson(app, 'GET', '/api/v1/export?format=csv');
    expect(noStore.statusCode).toBe(400);
  });
});

describe('exportStoreCsv (§9.4)', () => {
  it('writes the §9.1 header, active+bought rows and proper quoting', async () => {
    const res = await injectJson(app, 'GET', `/api/v1/export?format=csv&storeId=${storeId}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const csv = res.body;
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('store,category,name,aliases,qty,unit,note');
    // Bought row with the comma/quote note is quoted, not mangled.
    expect(csv).toContain('"a, ""rich"" note"');
    // Aliases are pipe-joined in the aliases column.
    expect(csv).toContain('chawal');
    // Only this store's two rows.
    expect(lines.filter((l) => l.includes('Toor Dal'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('Basmati Rice'))).toHaveLength(1);
  });

  it('exports only active+bought rows (no cleared history)', () => {
    const clearedId = seedListItem(app, { storeId, itemId: riceId, createdAt: clock.now() });
    app.db.prepare("UPDATE list_items SET status = 'cleared' WHERE id = ?").run(clearedId);
    const { csv } = exportStoreCsv(app.db, householdId, storeId);
    const dataRows = csv.trim().split('\r\n').slice(1);
    expect(dataRows).toHaveLength(2);
  });
});

describe('JSON round-trip (§9.1: export accepted back verbatim)', () => {
  it('restores the dump into a fresh database', async () => {
    const clearedId = seedListItem(app, { storeId: otherStoreId, itemId: riceId, createdAt: clock.now() });
    app.db.prepare("UPDATE list_items SET status = 'cleared' WHERE id = ?").run(clearedId);
    const source = exportJson(app.db, householdId, 1_730_000_000_000);
    expect(source.listItems).toHaveLength(4);

    const target = await buildTestApp();
    try {
      const targetActor = actor(target);
      const parsed = parseJsonImport(JSON.stringify(source));
      const preview = previewImport(target.db, targetActor.householdId, parsed);
      expect(preview.counts).toEqual({ new: 4, duplicate: 0, conflict: 0, invalid: 0 });
      const token = issuePreviewToken(
        'test-secret',
        targetActor.householdId,
        { rows: preview.rows, invalidLines: preview.invalidLines },
        1_730_000_100_000,
      );
      const result = commitImport(target.db, targetActor, 'test-secret', token, [], 1_730_000_100_000);
      // created counts catalog items (2); the second list row per item across
      // stores attaches to the item the first row created (merged = 2).
      expect(result).toEqual({ created: 2, merged: 2, skipped: 0 });

      const restored = exportJson(target.db, targetActor.householdId, 1_730_000_200_000);
      // Item identity and aliases survive verbatim…
      expect(restored.items.map((i) => [i.name, i.aliases.map((a) => a.alias)])).toEqual(
        source.items.map((i) => [i.name, i.aliases.map((a) => a.alias)]),
      );
      expect(restored.stores.map((s) => s.name)).toEqual(source.stores.map((s) => s.name));
      // …but the preview/commit model carries no list-row status: restored
      // rows are active. Known limitation (BACKLOG). Global listItems order
      // follows store UUIDs, which are regenerated — compare as multisets.
      const rowKey = (li: { name: string; qtyValue: number | null; unitCode: string | null; note: string | null }): string =>
        `${li.name}|${li.qtyValue}|${li.unitCode}|${li.note}`;
      expect(restored.listItems.map(rowKey).sort()).toEqual(source.listItems.map(rowKey).sort());
      expect(restored.listItems.every((li) => li.status === 'active')).toBe(true);
    } finally {
      await target.close();
    }
  });
});

describe('CSV round-trip (§9.4 → §9.1)', () => {
  it('imports an exported store list into a fresh database byte-stably', async () => {
    const { csv } = exportStoreCsv(app.db, householdId, storeId);

    const target = await buildTestApp();
    try {
      const targetActor = actor(target);
      const parsed = parseCsvImport(csv);
      const preview = previewImport(target.db, targetActor.householdId, parsed);
      expect(preview.counts.invalid).toBe(0);
      const result = commitImport(
        target.db,
        targetActor,
        'test-secret',
        issuePreviewToken(
          'test-secret',
          targetActor.householdId,
          { rows: preview.rows, invalidLines: preview.invalidLines },
          1_730_000_100_000,
        ),
        [],
        1_730_000_100_000,
      );
      expect(result).toEqual({ created: 2, merged: 0, skipped: 0 });

      const restoredId = (
        target.db.prepare('SELECT id FROM stores WHERE name = ?').get('Indian Store') as { id: string }
      ).id;
      expect(exportStoreCsv(target.db, targetActor.householdId, restoredId).csv).toBe(csv);    } finally {
      await target.close();
    }
  });
});
