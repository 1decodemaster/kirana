import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createGunzip, gunzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, seedCategories } from '@kirana/db';
import { actor, buildTestApp, FakeClock, injectJson } from './helpers.js';
import { createBackup, pruneBackups } from '../services/backup.js';

const DAY = 86_400_000;

describe('createBackup (§12.4)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kirana-backup-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a gzipped SQLite snapshot under <dataDir>/backups', async () => {
    const db = openDatabase(path.join(dir, 'kirana.db'));
    db.exec('CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO households (id, name) VALUES (?, ?)').run('h1', 'Home');

    const { file } = await createBackup(db, dir, 14, 1_730_000_000_000);
    expect(file).toMatch(/^kirana-\d{8}-\d{6}\.db\.gz$/);
    db.close();

    const plain = gunzipSync(readFileSync(path.join(dir, 'backups', file)));
    const restoredFile = path.join(dir, 'restored-check.db');
    await writeFile(restoredFile, plain);
    const restored = openDatabase(restoredFile);
    try {
      const row = restored.prepare('SELECT name FROM households WHERE id = ?').get('h1') as { name: string };
      expect(row.name).toBe('Home');
    } finally {
      restored.close();
    }
  });

  it('does not clobber an existing same-second file', async () => {
    const db = openDatabase(path.join(dir, 'kirana2.db'));
    db.exec('CREATE TABLE t (id INTEGER)');
    const first = await createBackup(db, dir, 14, 1_730_000_060_000);
    const second = await createBackup(db, dir, 14, 1_730_000_060_000);
    expect(second.file).not.toBe(first.file);
    db.close();
  });
});

describe('pruneBackups (NFR-11: 14 daily + 8 weekly)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kirana-prune-'));
    await mkdir(dir, { recursive: true });
    // 14 consecutive days (the daily window)…
    const daily = Array.from({ length: 14 }, (_, i) => new Date(1_760_000_000_000 + i * DAY));
    // …plus 10 files, one per UTC week, all older than the daily window.
    const weekly = Array.from({ length: 10 }, (_, i) => new Date(1_760_000_000_000 - (i + 2) * 7 * DAY));
    const stamp = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '');
    for (const [i, d] of [...daily, ...weekly].entries()) {
      await writeFile(path.join(dir, `kirana-${stamp(d)}-1200${String(i).padStart(2, '0')}.db.gz`), 'x');
    }
    // A stray non-backup file must be untouched.
    await writeFile(path.join(dir, 'kirana.db'), 'x');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the newest 14 daily files and the 8 newest weekly files', async () => {
    const { kept, removed } = await pruneBackups(dir, 14);
    expect(kept).toBe(22); // 14 daily + 8 weekly (10 weekly files − 2 pruned)
    expect(removed).toHaveLength(2);
    // The two oldest weekly files are the removed ones.
    const remaining = new Set(await readdir(dir));
    expect(remaining.size).toBe(23); // 22 backups + the stray kirana.db
    expect(remaining.has('kirana.db')).toBe(true);
  });
});

describe('POST /admin/backup (§12.4)', () => {
  let app: FastifyInstance;
  let dir: string;
  let clock: FakeClock;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kirana-admin-backup-'));
    app = await buildTestApp({ dataDir: dir, databaseUrl: path.join(dir, 'kirana.db') });
    clock = new FakeClock();
    actor(app);
    seedCategories(app.db, clock.now());
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the filename and writes the file', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/admin/backup');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { file: string };
    expect(body.file).toMatch(/^kirana-\d{8}-\d{6}\.db\.gz$/);

    const files = await readdir(path.join(dir, 'backups'));
    expect(files).toContain(body.file);

    // The snapshot restores into a working SQLite database.
    const plain = gunzipSync(readFileSync(path.join(dir, 'backups', body.file)));
    const restoredFile = path.join(dir, 'restored-check.db');
    await writeFile(restoredFile, plain);
    const restored = openDatabase(restoredFile);
    try {
      const households = restored.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
      expect(households.n).toBe(1);
    } finally {
      restored.close();
    }
  });

  it('requires the CSRF header like every mutation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/backup' });
    expect(res.statusCode).toBe(403);
  });

  it('produces a gzip file whose payload is a SQLite database', async () => {
    const files = await readdir(path.join(dir, 'backups'));
    const first = files[0];
    if (first === undefined) throw new Error('expected a backup file');
    const plain = gunzipSync(readFileSync(path.join(dir, 'backups', first)));
    expect(plain.subarray(0, 16).toString('utf8')).toContain('SQLite format 3');
    // Cross-check the streaming path used by createBackup.
    let bytes = 0;
    await pipeline(
      createReadStream(path.join(dir, 'backups', first)),
      createGunzip(),
      async function* (source) {
        for await (const chunk of source) bytes += (chunk as Buffer).length;
      },
    );
    expect(bytes).toBe(plain.length);
  });
});
