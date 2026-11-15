import type Database from 'better-sqlite3';
import type { ChangeEvent } from '@kirana/shared';

export interface ChangeInput {
  readonly entity: ChangeEvent['entity'];
  readonly entityId: string;
  readonly op: ChangeEvent['op'];
  readonly storeId?: string | null;
  readonly actorId?: string | null;
}

export function currentRevision(db: Database.Database): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS rev FROM change_log').get() as {
    rev: number;
  };
  return row.rev;
}

export function changedStoreIdsSince(db: Database.Database, since: number): Set<string> {
  const rows = db
    .prepare(
      'SELECT DISTINCT store_id FROM change_log WHERE id > ? AND store_id IS NOT NULL',
    )
    .all(since) as Array<{ store_id: string }>;
  return new Set(rows.map((r) => r.store_id));
}

export function appendChange(db: Database.Database, change: ChangeInput, now: number): number {
  const result = db
    .prepare(
      `INSERT INTO change_log (entity, entity_id, op, store_id, payload_json, actor_id, created_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(change.entity, change.entityId, change.op, change.storeId ?? null, change.actorId ?? null, now);
  return Number(result.lastInsertRowid);
}
