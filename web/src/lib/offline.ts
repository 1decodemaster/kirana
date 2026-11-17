/**
 * §4.7 client mutation state machine + G4.2/G4.3: mutations that fail with
 * a network error or 5xx are queued (IndexedDB) and replayed in order on
 * reconnect. Replay is idempotent via clientId (add) or idempotent verbs
 * (PATCH/bulk-check/clear); a 4xx on replay means the mutation was already
 * applied or is obsolete — the server value wins (last-write-wins, §4.7).
 */
import type { QueueEntry } from './queueTypes.js';

export interface QueueStore {
  all(): Promise<readonly QueueEntry[]>;
  add(entry: QueueEntry): Promise<void>;
  remove(clientId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DrainResult {
  readonly replayed: number;
  readonly dropped: number;
  readonly remaining: number;
}

/** Mutations that must never be queued: auth (they ARE the session),
 * import commit (single-use token), admin backup (host-side action). */
const NEVER_QUEUE: readonly string[] = ['/auth/', '/import/', '/admin/'];

export function isQueueable(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  return !NEVER_QUEUE.some((prefix) => path.includes(prefix));
}

/** Replay outcomes that mean "applied or obsolete" — drop silently. */
export function shouldDropOnReplay(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 410;
}

export interface SendResult {
  readonly ok: boolean;
  readonly status: number;
  readonly networkFailure: boolean;
}

/** Drain the queue oldest-first. Stops at the first failure so ordering is
 * preserved; the caller retries (e.g. on the next online event). */
export async function drainQueue(
  store: QueueStore,
  send: (entry: QueueEntry) => Promise<SendResult>,
): Promise<DrainResult> {
  let replayed = 0;
  let dropped = 0;
  const entries = await store.all();
  for (const entry of entries) {
    let result: SendResult;
    try {
      result = await send(entry);
    } catch {
      break;
    }
    if (result.networkFailure || result.status >= 500) break;
    if (result.ok) {
      await store.remove(entry.clientId);
      replayed += 1;
    } else if (shouldDropOnReplay(result.status)) {
      // Applied or obsolete — the server value wins (§4.7).
      await store.remove(entry.clientId);
      dropped += 1;
    } else {
      // 401/429/…: keep the entry and stop; the caller retries later.
      break;
    }
  }
  const remaining = (await store.all()).length;
  return { replayed, dropped, remaining };
}

/** §4.7 "Updated elsewhere": a replay dropped as obsolete surfaces once. */
export const QUEUE_DROPPED_EVENT = 'kirana:queue-dropped';

// ── count pub-sub for the offline banner (§8.7) ─────────────────────────

let count = 0;
const listeners = new Set<() => void>();

export function getQueueCount(): number {
  return count;
}

export function subscribeQueueCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setQueueCount(next: number): void {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

export async function refreshQueueCount(store: QueueStore): Promise<void> {
  setQueueCount((await store.all()).length);
}

export async function enqueueMutation(store: QueueStore, entry: QueueEntry): Promise<void> {
  await store.add(entry);
  await refreshQueueCount(store);
}

export async function clearQueue(store: QueueStore): Promise<void> {
  await store.clear();
  setQueueCount(0);
}

// ── the IndexedDB-backed store used at runtime ──────────────────────────

const DB_NAME = 'kirana-offline';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export const idbQueueStore: QueueStore = {
  async all(): Promise<readonly QueueEntry[]> {
    const rows = await withStore<readonly QueueEntry[]>(
      'readonly',
      (store) => store.getAll() as unknown as IDBRequest<readonly QueueEntry[]>,
    );
    return [...rows].sort((a, b) => a.createdAt - b.createdAt || a.clientId.localeCompare(b.clientId));
  },
  async add(entry: QueueEntry): Promise<void> {
    await withStore('readwrite', (store) => store.put(entry));
  },
  async remove(clientId: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(clientId));
  },
  async clear(): Promise<void> {
    await withStore('readwrite', (store) => store.clear());
  },
};
