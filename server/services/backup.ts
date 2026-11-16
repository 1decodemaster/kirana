import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type Database from 'better-sqlite3';

/** §12.4 / NFR-11: on-demand `.backup` → gzip under `${dataDir}/backups`,
 * pruned to BACKUP_KEEP_DAILY daily + 8 weekly files. The nightly 03:00
 * schedule itself is host cron (§12.4) — see BACKLOG. */

const KEEP_WEEKLY = 8;
const BACKUP_FILE = /^kirana-(\d{8})(?:-(\d{6}))?\.db\.gz$/;

export interface BackupResult {
  readonly file: string;
}

/** Online backup via better-sqlite3's sqlite3_backup binding (WAL-safe), then
 * gzip. `flags: 'wx'` refuses to clobber; a same-second collision gets a
 * suffixed name instead. */
export async function createBackup(
  db: Database.Database,
  dataDir: string,
  keepDaily: number,
  now: number,
): Promise<BackupResult> {
  const dir = path.join(dataDir, 'backups');
  await mkdir(dir, { recursive: true });

  const stamp = utcStamp(now);
  let dest = path.join(dir, `kirana-${stamp}.db.gz`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmp = `${dest}.tmp`;
    await db.backup(tmp);
    try {
      await pipeline(createReadStream(tmp), createGzip(), createWriteStream(dest, { flags: 'wx' }));
      await rm(tmp, { force: true });
      await pruneBackups(dir, keepDaily);
      return { file: path.basename(dest) };
    } catch (error) {
      await rm(tmp, { force: true });
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      dest = path.join(dir, `kirana-${stamp}-${attempt + 1}.db.gz`);
    }
  }
  throw new Error(`could not write a unique backup file for stamp ${stamp}`);
}

function utcStamp(now: number): string {
  const iso = new Date(now).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export interface PruneResult {
  readonly kept: number;
  readonly removed: readonly string[];
}

/** Retention (§12.4): the newest file of the newest `keepDaily` distinct days,
 * plus the newest file of the newest 8 distinct UTC-week buckets among the
 * older days. Week buckets are epoch-days/7 — retention bookkeeping, not an
 * ISO-week contract. */
export async function pruneBackups(dir: string, keepDaily: number, keepWeekly: number = KEEP_WEEKLY): Promise<PruneResult> {
  const entries = await readdir(dir);
  const files: Array<{ name: string; day: number; order: number }> = [];
  for (const name of entries) {
    const match = BACKUP_FILE.exec(name);
    if (match === null) continue;
    const day = Number(match[1]);
    const time = match[2] === undefined ? 0 : Number(match[2]);
    files.push({ name, day, order: day * 1000000 + time });
  }
  files.sort((a, b) => b.order - a.order);

  const keep = new Set<string>();
  const daysSeen = new Set<number>();
  for (const file of files) {
    if (daysSeen.size >= keepDaily) break;
    if (daysSeen.has(file.day)) continue;
    daysSeen.add(file.day);
    keep.add(file.name);
  }

  const weeksSeen = new Set<number>();
  for (const file of files) {
    if (weeksSeen.size >= keepWeekly) break;
    if (daysSeen.has(file.day)) continue;
    const week = Math.floor(epochDays(file.day) / 7);
    if (weeksSeen.has(week)) continue;
    weeksSeen.add(week);
    keep.add(file.name);
  }

  const removed: string[] = [];
  for (const file of files) {
    if (keep.has(file.name)) continue;
    await rm(path.join(dir, file.name), { force: true });
    removed.push(file.name);
  }
  return { kept: keep.size, removed };
}

/** YYYYMMDD → days since the Unix epoch (UTC). */
function epochDays(day: number): number {
  const year = Math.floor(day / 10000);
  const month = Math.floor(day / 100) % 100;
  const date = day % 100;
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}
