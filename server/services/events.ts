import type Database from 'better-sqlite3';
import { changeEventSchema, type ChangeEvent } from '@kirana/shared';

interface ChangeRow {
  readonly id: number;
  readonly entity: string;
  readonly entity_id: string;
  readonly op: string;
  readonly store_id: string | null;
}

/** Change_log rows after `since`, oldest first, parsed into the §7.5 event
 * shape. Bounded so a cold reconnect cannot starve the connection. */
export function changesSince(db: Database.Database, since: number, limit = 500): ChangeEvent[] {
  const rows = db
    .prepare(
      'SELECT id, entity, entity_id, op, store_id FROM change_log WHERE id > ? ORDER BY id LIMIT ?',
    )
    .all(since, limit) as ChangeRow[];
  return rows.map((row) =>
    changeEventSchema.parse({
      revision: row.id,
      entity: row.entity,
      entityId: row.entity_id,
      op: row.op,
      storeId: row.store_id,
    }),
  );
}

/** One §7.5 frame: `event: change`, `id: <revision>`, `data: <json>`. */
export function formatSseEvent(change: ChangeEvent): string {
  return `event: change\nid: ${change.revision}\ndata: ${JSON.stringify(change)}\n\n`;
}

export const SSE_HEARTBEAT = ': heartbeat\n\n';

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  // Reverse-proxy hint (R-5): never buffer the stream.
  'x-accel-buffering': 'no',
};
