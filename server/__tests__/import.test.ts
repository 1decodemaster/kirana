import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { importCommitResponseSchema, importPreviewResponseSchema, newUuidV7 } from '@kirana/shared';
import { seedCategories } from '@kirana/db';
import { actor, buildTestApp, FakeClock, injectJson, seedCatalogItem, seedStore } from './helpers.js';
import { inferAliasLang, parseCsvImport, parseJsonImport } from '../services/importParse.js';
import { commitImport } from '../services/importCommit.js';
import { previewImport } from '../services/importPreview.js';
import { issuePreviewToken } from '../services/importToken.js';

let app: FastifyInstance;
let clock: FakeClock;
let householdId: string;
let memberId: string;
let storeId: string;

beforeEach(async () => {
  app = await buildTestApp();
  clock = new FakeClock();
  const a = actor(app, clock);
  householdId = a.householdId;
  memberId = a.memberId;
  seedCategories(app.db, clock.now());
  storeId = seedStore(app, householdId, 'Indian Store', clock.now());
});

afterAll(async () => {
  await app.close();
});

function multipartBody(content: string, contentType: string, filename: string): string {
  const boundary = '----kirana-test';
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function previewUpload(content: string, contentType = 'text/csv'): Promise<LightMyRequestResponse> {
  return injectJson(app, 'POST', '/api/v1/import/preview', {
    payload: multipartBody(content, contentType, 'import.csv'),
    headers: { 'content-type': 'multipart/form-data; boundary=----kirana-test' },
  });
}

async function commit(
  token: string,
  decisions: Array<Record<string, unknown>> = [],
): Promise<LightMyRequestResponse> {
  return injectJson(app, 'POST', '/api/v1/import/commit', { payload: { token, decisions } });
}

function first<T>(xs: readonly T[]): T {
  const value = xs[0];
  if (value === undefined) throw new Error('expected a non-empty list');
  return value;
}

describe('parseCsvImport (§9.1)', () => {
  it('maps the documented header and keeps physical line numbers', () => {
    const rows = parseCsvImport(
      'store,category,name,aliases,qty,unit,note\nIndian Store,Grains & Lentils,Basmati Rice,chawal|चावल,5,kg,\nCostco,Produce,Tomatoes,,1,kg,',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, store: 'Indian Store', name: 'Basmati Rice', qty: 5, unit: 'kg' });
    expect(rows[0]?.aliases).toEqual(['chawal', 'चावल']);
    expect(rows[1]).toMatchObject({ line: 3, store: 'Costco', note: null });
  });

  it('rejects a missing header or required columns with IMPORT_PARSE_FAILED', () => {
    expect(() => parseCsvImport('')).toThrowError(/header/);
    expect(() => parseCsvImport('category,name\nX,Y')).toThrowError(/store/);
    expect(() => parseCsvImport('store,name,extra\nA,B,C')).toThrowError(/extra/);
  });

  it('marks broken rows invalid instead of failing the file', () => {
    const rows = parseCsvImport(
      'store,name,qty,unit\nIndian Store,Rice,0,kg\n,Unnamed,1,kg\nIndian Store,Dal,abc,kg\nIndian Store,Atta,5,teaspoon',
    );
    expect(rows[0]?.error).toMatch(/greater than 0/);
    expect(rows[1]?.error).toMatch(/store is required/);
    expect(rows[2]?.error).toMatch(/not a number/);
    expect(rows[3]?.error).toMatch(/not a known unit/);
  });
});

describe('inferAliasLang (§9.1)', () => {
  it('infers hi, hi-Latn and en', () => {
    expect(inferAliasLang('चावल', 'Basmati Rice')).toBe('hi');
    expect(inferAliasLang('chawal', 'चावल')).toBe('hi-Latn');
    expect(inferAliasLang('rice', 'Basmati Rice')).toBe('en');
  });
});

describe('rowsFromExportPayload', () => {
  it('turns list rows into import rows with item identity and aliases', () => {
    const itemId = newUuidV7(1);
    const storeIdLocal = newUuidV7(2);
    const categoryId = newUuidV7(3);
    const rows = parseJsonImport(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: 1730000000000,
        household: { id: newUuidV7(4), name: 'Home' },
        categories: [{ id: categoryId, name: 'Produce', scope: 'grocery', icon: null, color: null, sortOrder: 0 }],
        stores: [
          {
            id: storeIdLocal,
            name: 'Costco',
            iconKind: 'emoji',
            iconRef: null,
            status: 'active',
            categoryOrder: [],
            sortOrder: 0,
            counts: { total: 1, bought: 0 },
            items: [],
            notes: null,
          },
        ],
        items: [
          {
            id: itemId,
            name: 'Tomatoes',
            norm: 'tomatoes',
            defaultCategoryId: null,
            defaultUnitCode: null,
            defaultQty: null,
            iconKind: 'emoji',
            iconRef: null,
            attrs: {},
            aliases: [{ id: newUuidV7(5), alias: 'tamatar', lang: 'hi-Latn' }],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        listItems: [
          {
            id: newUuidV7(6),
            storeId: storeIdLocal,
            itemId,
            name: 'Tomatoes',
            qtyValue: 2,
            unitCode: 'kg',
            categoryId,
            status: 'active',
            note: 'roma',
            addedBy: null,
            updatedAt: 1,
          },
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(first(rows)).toMatchObject({
      line: 1,
      store: 'Costco',
      category: 'Produce',
      name: 'Tomatoes',
      aliases: ['tamatar'],
      qty: 2,
      unit: 'kg',
      note: 'roma',
      error: null,
    });
  });
});

describe('POST /import/preview (§9.3)', () => {
  it('returns the diff and a signed token for a fresh file', async () => {
    const res = await previewUpload(
      'store,category,name,aliases,qty,unit,note\nIndian Store,Grains & Lentils,Basmati Rice,chawal,5,kg,\nIndian Store,Produce,Tomatoes,,,kg,',
    );
    expect(res.statusCode).toBe(200);
    const body = importPreviewResponseSchema.parse(res.json());
    expect(body.new).toBe(2);
    expect(body.duplicate).toBe(0);
    expect(body.conflict).toBe(0);
    expect(body.invalid).toBe(0);
    expect(first(body.rows).action).toBe('create');
    expect(body.token).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{64}$/);
  });

  it('suggests merge for an existing name, alias and a close typo', async () => {
    seedCatalogItem(app, householdId, 'Basmati Rice', clock.now(), { unit: 'kg' });
    await injectJson(app, 'POST', '/api/v1/items', {
      payload: { name: 'Tomatoes', aliases: [{ alias: 'tamatar', lang: 'hi-Latn' }] },
    });

    const res = await previewUpload(
      'store,name\nIndian Store,Basmati Rice\nIndian Store,tamatar\nIndian Store,Basmati Rices',
    );
    const body = importPreviewResponseSchema.parse(res.json());
    expect(body.duplicate).toBe(3);
    expect(body.new).toBe(0);
    for (const row of body.rows) {
      expect(row.action).toBe('merge');
      expect(row.targetItemId).not.toBeNull();
    }
    expect(first(body.rows).message).toBe('Matches an existing item by name');
    expect(body.rows[1]?.message).toBe('Matches an existing item by alias');
    expect(body.rows[2]?.message).toBe('Similar to "Basmati Rice"');
  });

  it('flags in-file duplicates on the same store but keeps cross-store rows', async () => {
    const res = await previewUpload('store,name\nIndian Store,Rice\nIndian Store,Rice\nCostco,Rice');
    const body = importPreviewResponseSchema.parse(res.json());
    expect(body.new).toBe(2);
    expect(body.conflict).toBe(1);
    expect(body.rows[1]?.action).toBe('skip');
    expect(body.rows[1]?.message).toContain('line 2');
    expect(body.rows[2]?.action).toBe('create');
  });

  it('counts invalid rows and still previews the valid ones', async () => {
    const res = await previewUpload('store,name,qty\nIndian Store,Dal,2\n,No store,1\nIndian Store,Bad qty,x');
    const body = importPreviewResponseSchema.parse(res.json());
    expect(body.invalid).toBe(2);
    expect(body.new).toBe(1);
    expect(body.rows[0]?.action).toBe('create');
    expect(body.rows[1]?.action).toBe('error');
  });

  it('rejects a JSON upload that does not match the export payload schema', async () => {
    const res = await previewUpload(JSON.stringify({ schemaVersion: 1, bogus: true }), 'application/json');
    expect(res.statusCode).toBe(400);
    const json = res.json() as { error?: { code?: string } };
    expect(json.error?.code).toBe('IMPORT_PARSE_FAILED');
  });

  it('rejects a parsed body without a file part', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/import/preview', {
      payload: { not: 'a file' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const json = res.json() as { error?: { code?: string } };
    expect(json.error?.code).toBe('IMPORT_PARSE_FAILED');
  });
});

describe('POST /import/commit (§9.3)', () => {
  interface PreviewBody {
    token: string;
    rows: Array<{ line: number; action: string; targetItemId: string | null; name: string }>;
  }

  async function preview(csv: string): Promise<PreviewBody> {
    const res = await previewUpload(csv);
    expect(res.statusCode).toBe(200);
    return res.json() as PreviewBody;
  }

  it('creates items, aliases, stores and categories in one commit', async () => {
    const p = await preview(
      'store,category,name,aliases,qty,unit,note\nNew Store,New Category,Chana Dal,chana|चना दाल,2,kg,soaked overnight',
    );
    const res = await commit(p.token);
    expect(res.statusCode).toBe(200);
    expect(importCommitResponseSchema.parse(res.json())).toEqual({ created: 1, merged: 0, skipped: 0 });

    const item = app.db
      .prepare('SELECT id, name, default_unit_code, default_qty FROM items WHERE name = ?')
      .get('Chana Dal') as { id: string; default_unit_code: string | null; default_qty: number | null };
    expect(item.default_unit_code).toBe('kg');
    expect(item.default_qty).toBe(2);

    const aliases = app.db
      .prepare('SELECT alias, lang, source FROM item_aliases WHERE item_id = ? ORDER BY alias')
      .all(item.id) as Array<{ alias: string; lang: string; source: string }>;
    expect(aliases.map((a) => a.alias).sort()).toEqual(['chana', 'चना दाल']);
    expect(aliases.every((a) => a.source === 'import')).toBe(true);
    expect(aliases.find((a) => a.alias === 'चना दाल')?.lang).toBe('hi');

    const category = app.db
      .prepare("SELECT id, scope, is_seed FROM categories WHERE name = 'New Category'")
      .get() as { id: string; scope: string; is_seed: number };
    expect(category).toMatchObject({ scope: 'grocery', is_seed: 0 });

    const store = app.db.prepare("SELECT id FROM stores WHERE name = 'New Store'").get() as { id: string };
    const listRow = app.db
      .prepare('SELECT status, note, category_id, added_by FROM list_items WHERE store_id = ?')
      .get(store.id) as { status: string; note: string | null; category_id: string | null; added_by: string | null };
    expect(listRow).toMatchObject({ status: 'active', note: 'soaked overnight', category_id: category.id, added_by: memberId });

    const stats = app.db
      .prepare('SELECT times_added FROM item_store_stats WHERE item_id = ? AND store_id = ?')
      .get(item.id, store.id) as { times_added: number };
    expect(stats.times_added).toBe(1);

    const entities = app.db.prepare('SELECT entity, op FROM change_log ORDER BY id').all() as Array<{
      entity: string;
      op: string;
    }>;
    expect(entities).toContainEqual({ entity: 'store', op: 'create' });
    expect(entities).toContainEqual({ entity: 'category', op: 'create' });
    expect(entities).toContainEqual({ entity: 'item', op: 'create' });
    expect(entities).toContainEqual({ entity: 'list_item', op: 'create' });
  });

  it('matches stores and categories case-insensitively instead of duplicating them', async () => {
    const p = await preview('store,category,name\nINDIAN STORE,grains & lentils,Rice');
    await commit(p.token);
    const stores = app.db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number };
    const categories = app.db
      .prepare("SELECT COUNT(*) AS n FROM categories WHERE name_norm = 'grains lentils'")
      .get() as { n: number };
    expect(stores.n).toBe(1);
    expect(categories.n).toBe(1);
  });

  it('revives a soft-deleted store on import', async () => {
    await injectJson(app, 'DELETE', `/api/v1/stores/${storeId}`);
    const p = await preview('store,name\nIndian Store,Rice');
    const res = await commit(p.token);
    expect(res.statusCode).toBe(200);
    const row = app.db.prepare('SELECT deleted_at, status FROM stores WHERE id = ?').get(storeId) as {
      deleted_at: number | null;
      status: string;
    };
    expect(row.deleted_at).toBeNull();
    expect(row.status).toBe('active');
  });

  it('applies explicit decisions: skip a duplicate, merge onto a chosen target', async () => {
    seedCatalogItem(app, householdId, 'Toor Dal', clock.now(), { unit: 'kg' });
    const p = await preview('store,name,qty,unit\nIndian Store,Masoor Dal,1,kg\nIndian Store,Toor Dal,2,kg');
    const toorRow = p.rows.find((r) => r.name === 'Toor Dal');
    expect(toorRow?.action).toBe('merge');
    const res = await commit(p.token, [
      { line: 2, action: 'create' },
      { line: 3, action: 'merge', targetItemId: toorRow?.targetItemId },
    ]);
    expect(res.statusCode).toBe(200);
    expect(importCommitResponseSchema.parse(res.json())).toEqual({ created: 1, merged: 1, skipped: 0 });

    const items = app.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    expect(items.n).toBe(2);
    const toorId = (app.db.prepare('SELECT id FROM items WHERE name = ?').get('Toor Dal') as { id: string }).id;
    const rows = app.db
      .prepare('SELECT qty_value FROM list_items WHERE item_id = ?')
      .all(toorId) as Array<{ qty_value: number | null }>;
    expect(rows.map((r) => r.qty_value)).toEqual([2]);
  });

  it('defaults undecided lines to their preview action', async () => {
    const p = await preview('store,name\nIndian Store,Rice\nIndian Store,Rice');
    const res = await commit(p.token);
    expect(res.statusCode).toBe(200);
    expect(importCommitResponseSchema.parse(res.json())).toEqual({ created: 1, merged: 0, skipped: 1 });
  });

  it('rejects bad decisions with 400/404 and rolls everything back', async () => {
    const p = await preview('store,name\nIndian Store,Rice\nIndian Store,Dal');

    const badLine = await commit(p.token, [{ line: 99, action: 'skip' }]);
    expect(badLine.statusCode).toBe(400);

    const dupLine = await commit(p.token, [
      { line: 2, action: 'skip' },
      { line: 2, action: 'skip' },
    ]);
    expect(dupLine.statusCode).toBe(400);

    const noTarget = await commit(p.token, [{ line: 2, action: 'merge' }]);
    expect(noTarget.statusCode).toBe(400);

    const badTarget = await commit(p.token, [{ line: 2, action: 'merge', targetItemId: newUuidV7(clock.now()) }]);
    expect(badTarget.statusCode).toBe(404);

    const items = app.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    expect(items.n).toBe(0);

    // The token survives a failed commit so the user can retry.
    const retry = await commit(p.token, [
      { line: 2, action: 'create' },
      { line: 3, action: 'skip' },
    ]);
    expect(retry.statusCode).toBe(200);
    expect(importCommitResponseSchema.parse(retry.json())).toEqual({ created: 1, merged: 0, skipped: 1 });
  });

  it('consumes the token after a successful commit', async () => {
    const p = await preview('store,name\nIndian Store,Rice');
    await commit(p.token);
    const replay = await commit(p.token);
    expect(replay.statusCode).toBe(410);
    const json = replay.json() as { error?: { code?: string } };
    expect(json.error?.code).toBe('IMPORT_TOKEN_EXPIRED');
  });

  it('rejects unknown and tampered tokens', async () => {
    const unknown = await commit(`${'a'.repeat(32)}.${'b'.repeat(64)}`);
    expect(unknown.statusCode).toBe(410);
    const tampered = await commit(`${'a'.repeat(32)}.${'c'.repeat(64)}`);
    expect(tampered.statusCode).toBe(410);
  });
});

describe('preview token TTL (§9.3: 10 minutes)', () => {
  it('commits a fresh token and rejects one older than 10 minutes', () => {
    const t0 = 1_730_000_000_000;
    const secret = 'test-secret';
    const preview = previewImport(app.db, householdId, parseCsvImport('store,name\nIndian Store,Rice'));
    const token = issuePreviewToken(secret, householdId, { rows: preview.rows, invalidLines: preview.invalidLines }, t0);

    const fresh = commitImport(app.db, { householdId, memberId }, secret, token, [], t0 + 9 * 60_000);
    expect(fresh).toEqual({ created: 1, merged: 0, skipped: 0 });

    const preview2 = previewImport(app.db, householdId, parseCsvImport('store,name\nIndian Store,Atta'));
    const token2 = issuePreviewToken(secret, householdId, { rows: preview2.rows, invalidLines: preview2.invalidLines }, t0);
    expect(() => commitImport(app.db, { householdId, memberId }, secret, token2, [], t0 + 10 * 60_000 + 1)).toThrowError(
      /expired/,
    );
  });
});
