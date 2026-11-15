import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
}

export function migrate(db: Database.Database, migrations: readonly Migration[]): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    db.prepare('SELECT name FROM __migrations').all().map((r) => (r as { name: string }).name),
  );
  const appliedNow: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
        m.name,
        Date.now(),
      );
    });
    run();
    appliedNow.push(m.name);
  }
  return appliedNow;
}

export function listApplied(db: Database.Database): string[] {
  return db
    .prepare('SELECT name FROM __migrations ORDER BY name')
    .all()
    .map((r) => (r as { name: string }).name);
}

export interface SchemaEntry {
  readonly type: string;
  readonly name: string;
  readonly sql: string;
}

export function readSchemaEntries(db: Database.Database): SchemaEntry[] {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != '__migrations' ORDER BY type, name",
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
  return rows.map((r) => ({ type: r.type, name: r.name, sql: r.sql }));
}

export function computeSchemaHash(db: Database.Database): string {
  const canonical = readSchemaEntries(db)
    .map((e) => `${e.type}|${e.name}|${e.sql}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}
