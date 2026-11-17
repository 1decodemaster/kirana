/**
 * NFR measurement harness (PRD §10, G5.1) — run against the BUILT server:
 *
 *   pnpm build
 *   tsx scripts/perf-nfr.ts
 *
 * Seeds a temp database at the §10 scale (2,000 items / 500 list rows /
 * 2,000 change_log rows), boots `server/dist/index.js`, and measures over
 * real HTTP:
 *
 *   NFR-1  GET /board p95 ≤ 50ms              (corroborates board.perf.test)
 *   NFR-2  endpoint mix p95 ≤ 100ms each
 *   NFR-8  DB size projected < 50MB at 10 years (model printed)
 *   NFR-9  cold start → first /healthz 200 ≤ 2s
 *   NFR-10 RSS ≤ 256MB after the load run
 *   NFR-15 pino JSON lines, reqId present, passcode/cookie never logged
 *
 * Exit code 1 if any budget is missed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPasscode, loadMigrations, migrate, openDatabase, seedCategories } from '../db/dist/index.js';
import { newUuidV7, normalizeName } from '../shared/dist/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

const ITEMS = 2000;
const LIST_ROWS = 500;
const CHANGE_ROWS = 2000;
const STORES = 10;
const CANARY_PASSCODE = 'perf-canary-123';
const BOARD_SAMPLES = 120;
const MIX_SAMPLES = 20;
const WARMUP = 10;

const failures: string[] = [];
function check(budget: string, value: number, limit: number): void {
  const ok = value <= limit;
  if (!ok) failures.push(`${budget}: ${value.toFixed(1)} > ${limit}`);
  console.info(`  ${ok ? 'PASS' : 'MISS'}  ${budget}: ${value.toFixed(1)} (limit ${limit})`);
}

function stats(samples: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.ceil(sorted.length * q) - 1];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

async function main(): Promise<void> {
  if (!existsSync(SERVER_ENTRY)) {
    console.error('server/dist/index.js not found — run `pnpm build` first');
    process.exit(1);
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), 'kirana-perf-'));
  const dbPath = path.join(dataDir, 'kirana.db');
  const port = 18770 + (process.pid % 200);
  const base = `http://127.0.0.1:${port}`;

  const { mergeStoreId, firstItemId } = await seedFixture(dbPath);

  const logs: string[] = [];
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_URL: dbPath,
      SESSION_SECRET: 'perf-secret-0123456789abcdef',
      LOG_LEVEL: 'info',
      KIRANA_REVISION: 'perf-run',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));

  try {
    // ── NFR-9: cold start → first /healthz 200 ──────────────────────────
    const t0 = performance.now();
    let coldStartMs = -1;
    while (performance.now() - t0 < 10_000) {
      try {
        const res = await fetch(`${base}/healthz`);
        if (res.ok) {
          coldStartMs = performance.now() - t0;
          break;
        }
      } catch {
        await sleep(25);
      }
    }
    console.info('\nNFR-9 cold start (spawn → first /healthz 200)');
    check('cold start ms', coldStartMs, 2000);
    if (coldStartMs < 0) throw new Error('server did not come up in 10s');

    // ── login (the canary passcode must never appear in logs — NFR-15) ──
    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'kirana' },
      body: JSON.stringify({ passcode: CANARY_PASSCODE, displayName: 'Alex' }),
    });
    if (loginRes.status !== 200) throw new Error(`login failed: ${loginRes.status}`);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const sid = /sid=([^;]+)/.exec(setCookie)?.[1];
    if (sid === undefined) throw new Error('login returned no sid cookie');
    const authHeaders = { cookie: `sid=${sid}`, 'x-requested-with': 'kirana' };

    // ── NFR-1: GET /board over real HTTP ────────────────────────────────
    for (let i = 0; i < WARMUP; i += 1) await get(base, '/api/v1/board', authHeaders);
    const boardSamples: number[] = [];
    for (let i = 0; i < BOARD_SAMPLES; i += 1) {
      const start = performance.now();
      const res = await get(base, '/api/v1/board', authHeaders);
      boardSamples.push(performance.now() - start);
      if (res.status !== 200) throw new Error(`board returned ${res.status}`);
    }
    console.info(`\nNFR-1 GET /board over real HTTP (${BOARD_SAMPLES} sequential samples)`);
    const board = stats(boardSamples);
    console.info(
      `  p50 ${board.p50.toFixed(1)}ms  p95 ${board.p95.toFixed(1)}ms  p99 ${board.p99.toFixed(1)}ms`,
    );
    check('board p95 ms', board.p95, 50);

    // ── NFR-2: endpoint mix ─────────────────────────────────────────────
    const mix: ReadonlyArray<{
      name: string;
      url: string;
      method?: string;
      body?: string;
    }> = [
      { name: 'GET /board', url: '/api/v1/board' },
      { name: 'GET /auth/me', url: '/api/v1/auth/me' },
      { name: 'GET /categories', url: '/api/v1/categories' },
      { name: 'GET /items?q=item 12', url: `/api/v1/items?q=${encodeURIComponent('item 12')}` },
      { name: 'GET /items/:id', url: `/api/v1/items/${firstItemId}` },
      { name: 'GET /export?format=json', url: '/api/v1/export?format=json' },
      {
        name: 'POST /stores/:id/items (merge)',
        url: `/api/v1/stores/${mergeStoreId}/items`,
        method: 'POST',
        // Fixed clientId: run 1 merges, runs 2+ are deterministic replays.
        body: JSON.stringify({ clientId: '01913b5e-7d5a-7000-8000-000000000001', name: 'Item 4' }),
      },
    ];
    console.info(`\nNFR-2 endpoint mix (${MIX_SAMPLES} samples each)`);
    for (const endpoint of mix) {
      const samples: number[] = [];
      for (let i = 0; i < MIX_SAMPLES; i += 1) {
        const start = performance.now();
        const res = await fetch(`${base}${endpoint.url}`, {
          method: endpoint.method ?? 'GET',
          headers: {
            ...authHeaders,
            ...(endpoint.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(endpoint.body === undefined ? {} : { body: endpoint.body }),
        });
        samples.push(performance.now() - start);
        if (res.status !== 200) throw new Error(`${endpoint.name} returned ${res.status}`);
      }
      const s = stats(samples);
      console.info(
        `  ${endpoint.name.padEnd(34)} p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  p99 ${s.p99.toFixed(1)}`,
      );
      check(`${endpoint.name} p95 ms`, s.p95, 100);
    }

    // ── NFR-10: RSS after the load run ──────────────────────────────────
    const rssKb = readRssKb(child.pid);
    console.info('\nNFR-10 RSS after the load run');
    if (rssKb === null) {
      failures.push('RSS: /proc status unavailable');
      console.info('  MISS  /proc/<pid>/status unavailable');
    } else {
      check('RSS MB', rssKb / 1024, 256);
    }

    // ── NFR-8: DB size + 10-year projection ─────────────────────────────
    reportDbSize(dbPath);

    // ── NFR-15: log shape ───────────────────────────────────────────────
    console.info('\nNFR-15 log shape');
    const lines = logs.join('').split('\n').filter((l) => l.trim().length > 0);
    const unparseable = lines.filter((l) => !l.startsWith('{') || !isJson(l));
    if (unparseable.length > 0) {
      failures.push(`NFR-15: ${unparseable.length} non-JSON log lines`);
      console.info(`  MISS  ${unparseable.length}/${lines.length} lines are not JSON`);
    } else {
      console.info(`  PASS  ${lines.length}/${lines.length} lines are JSON`);
    }
    const withReqId = lines.filter((l) => l.includes('"reqId"')).length;
    if (withReqId === 0) failures.push('NFR-15: no log line carries reqId');
    console.info(`  ${withReqId > 0 ? 'PASS' : 'MISS'}  ${withReqId} lines carry reqId`);
    const leaked = lines.filter(
      (l) => l.includes(CANARY_PASSCODE) || l.includes('sid=') || /set-cookie/i.test(l),
    );
    if (leaked.length > 0) {
      failures.push(`NFR-15: ${leaked.length} lines leak passcode/cookie`);
      console.info('  MISS  passcode or cookie material found in logs');
    } else {
      console.info('  PASS  no passcode / sid / set-cookie in logs');
    }
  } finally {
    child.kill('SIGTERM');
    await exitCode(child);
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} budget(s) missed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.info('\nAll measured budgets met.');
}

// ── helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(base: string, url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}${url}`, { headers });
}

function isJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function readRssKb(pid: number | undefined): number | null {
  if (pid === undefined) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return m === null ? null : Number(m[1]);
  } catch {
    return null;
  }
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
}

async function seedFixture(dbPath: string): Promise<{ mergeStoreId: string; firstItemId: string }> {
  const db = openDatabase(dbPath);
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  const now = 1_730_000_000_000;
  seedCategories(db, now);
  const householdId = newUuidV7(now);
  db.prepare('INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)').run(
    householdId,
    'Perf Household',
    await hashPasscode(CANARY_PASSCODE),
    now,
  );
  const insertMember = db.prepare(
    'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const alexId = newUuidV7(now + 1);
  insertMember.run(alexId, householdId, 'Alex', '#4F46E5', now + 1);
  insertMember.run(newUuidV7(now + 2), householdId, 'Sam', '#059669', now + 2);

  const categories = db
    .prepare('SELECT id FROM categories WHERE scope = ? ORDER BY sort_order LIMIT 5')
    .all('grocery') as Array<{ id: string }>;

  const insertStore = db.prepare(
    `INSERT INTO stores (id, household_id, name, name_norm, icon_kind, icon_ref, status,
            category_order_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'emoji', '🏬', 'active', '[]', 0, ?, ?)`,
  );
  const storeIds: string[] = [];
  for (let s = 0; s < STORES; s += 1) {
    const id = newUuidV7(now + 100 + s);
    insertStore.run(id, householdId, `Store ${s}`, normalizeName(`Store ${s}`), now, now);
    storeIds.push(id);
  }

  const insertItem = db.prepare(
    `INSERT INTO items (id, household_id, name, name_norm, default_category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertListRow = db.prepare(
    `INSERT INTO list_items (id, store_id, item_id, qty_value, unit_code, category_id,
            status, checked_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'kg', ?, ?, ?, ?, ?, ?)`,
  );
  const rowIds: string[] = [];
  db.transaction(() => {
    for (let n = 0; n < ITEMS; n += 1) {
      const itemId = newUuidV7(now + 1_000 + n);
      insertItem.run(
        itemId,
        householdId,
        `Item ${n}`,
        `item ${n}`,
        categories[n % categories.length].id,
        now,
        now,
      );
      if (n % 4 === 0 && rowIds.length < LIST_ROWS) {
        const bought = n % 3 === 0;
        const rowId = newUuidV7(now + 50_000 + n);
        insertListRow.run(
          rowId,
          storeIds[(n / 4) % STORES],
          itemId,
          (n % 5) + 1,
          categories[n % categories.length].id,
          bought ? 'bought' : 'active',
          bought ? now + 60_000 : null,
          n % 7,
          now + n,
          now + n,
        );
        rowIds.push(rowId);
      }
    }
    const insertChange = db.prepare(
      `INSERT INTO change_log (entity, entity_id, op, store_id, payload_json, actor_id, created_at)
       VALUES ('list_item', ?, 'update', ?, '{"qty_value":2}', ?, ?)`,
    );
    for (let c = 0; c < CHANGE_ROWS; c += 1) {
      insertChange.run(rowIds[c % rowIds.length], storeIds[c % STORES], alexId, now + 100_000 + c);
    }
  })();

  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM list_items) AS list_rows,
              (SELECT COUNT(*) FROM change_log) AS changes`,
    )
    .get() as { items: number; list_rows: number; changes: number };
  const firstItemId = (
    db.prepare('SELECT id FROM items ORDER BY created_at, id LIMIT 1').get() as { id: string }
  ).id;
  console.info(
    `fixture: ${counts.items} items, ${counts.list_rows} list rows, ${counts.changes} change_log rows`,
  );
  db.close();
  // Item 4 sits as an active row in store (4/4)%10 = 1 — the merge target.
  return { mergeStoreId: storeIds[1], firstItemId };
}

function reportDbSize(dbPath: string): void {
  const bytes = statSync(dbPath).size;
  const db = openDatabase(dbPath);
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM items) AS items,
              (SELECT COUNT(*) FROM item_aliases) AS aliases,
              (SELECT COUNT(*) FROM list_items) AS list_rows,
              (SELECT COUNT(*) FROM change_log) AS changes,
              (SELECT COUNT(*) FROM item_store_stats) AS stats,
              (SELECT COALESCE(SUM(LENGTH(payload_json)),0) FROM change_log) AS change_payload_bytes`,
    )
    .get() as {
    items: number;
    aliases: number;
    list_rows: number;
    changes: number;
    stats: number;
    change_payload_bytes: number;
  };
  db.close();

  const fixtureRows =
    counts.items + counts.aliases + counts.list_rows + counts.changes + counts.stats + 40;
  const bytesPerRow = bytes / fixtureRows;

  // 10-year model (stated): items 1,000/year; aliases 1.5/item; stats 1/item;
  // list rows bounded at 1,500 by the §6.7 purge; change_log ~25/day;
  // small tables (stores/categories/members/sessions) ~500 rows total.
  const model = {
    items: 10_000,
    aliases: 15_000,
    stats: 10_000,
    list_rows: 1_500,
    changes: 90_000,
    small: 500,
  };
  const projectedRows =
    model.items + model.aliases + model.stats + model.list_rows + model.changes + model.small;

  // change_log dominates: scale its measured payload content linearly; the
  // remaining row-count growth scales at the whole-file bytes/row (which
  // already includes index + per-row overhead).
  const changeScale = model.changes / counts.changes;
  const projected =
    bytes + counts.change_payload_bytes * (changeScale - 1) + (projectedRows - fixtureRows) * bytesPerRow;

  console.info('\nNFR-8 DB size');
  console.info(
    `  fixture: ${(bytes / 1024 / 1024).toFixed(2)}MB over ${fixtureRows} rows (${bytesPerRow.toFixed(0)} B/row)`,
  );
  console.info(
    `  change_log payload ${counts.change_payload_bytes}B over ${counts.changes} rows (${(counts.change_payload_bytes / counts.changes).toFixed(0)} B/payload)`,
  );
  console.info(
    `  model: items ${model.items}, aliases ${model.aliases}, stats ${model.stats}, list ${model.list_rows}, change_log ${model.changes}, small ${model.small}`,
  );
  check('projected 10-year size MB', projected / 1024 / 1024, 50);
}

void main();
