import { describe, expect, it } from 'vitest';
import {
  clearQueue,
  drainQueue,
  enqueueMutation,
  getQueueCount,
  isQueueable,
  refreshQueueCount,
  setQueueCount,
  shouldDropOnReplay,
  subscribeQueueCount,
  type QueueStore,
} from './offline.js';
import type { QueueEntry } from './queueTypes.js';

function memoryStore(initial: readonly QueueEntry[] = []): QueueStore {
  const rows = new Map(initial.map((entry) => [entry.clientId, entry]));
  return {
    async all() {
      return [...rows.values()];
    },
    async add(entry) {
      rows.set(entry.clientId, entry);
    },
    async remove(clientId) {
      rows.delete(clientId);
    },
    async clear() {
      rows.clear();
    },
  };
}

function entry(clientId: string, createdAt = 1): QueueEntry {
  return { clientId, method: 'PATCH', path: `/api/v1/list-items/${clientId}`, createdAt };
}

describe('isQueueable (§4.7 scope)', () => {
  it('queues non-GET API mutations', () => {
    expect(isQueueable('PATCH', '/api/v1/list-items/x')).toBe(true);
    expect(isQueueable('POST', '/api/v1/stores/s/items')).toBe(true);
    expect(isQueueable('DELETE', '/api/v1/list-items/x')).toBe(true);
  });

  it('never queues GETs, auth, import or admin calls', () => {
    expect(isQueueable('GET', '/api/v1/board')).toBe(false);
    expect(isQueueable('POST', '/api/v1/auth/login')).toBe(false);
    expect(isQueueable('POST', '/api/v1/auth/members')).toBe(false);
    expect(isQueueable('POST', '/api/v1/import/commit')).toBe(false);
    expect(isQueueable('POST', '/api/v1/admin/backup')).toBe(false);
  });
});

describe('shouldDropOnReplay (§4.7 last-write-wins)', () => {
  it('drops applied-or-obsolete outcomes, keeps 5xx for retry', () => {
    for (const status of [400, 404, 409, 410]) expect(shouldDropOnReplay(status)).toBe(true);
    for (const status of [200, 401, 429, 500]) expect(shouldDropOnReplay(status)).toBe(false);
  });
});

describe('drainQueue (G4.2/G4.3)', () => {
  it('replays in order and removes drained entries', async () => {
    const store = memoryStore([entry('a', 1), entry('b', 2)]);
    const sent: string[] = [];
    const result = await drainQueue(store, async (e) => {
      sent.push(e.clientId);
      return { ok: true, status: 200, networkFailure: false };
    });
    expect(sent).toEqual(['a', 'b']);
    expect(result).toEqual({ replayed: 2, dropped: 0, remaining: 0 });
    expect(await store.all()).toHaveLength(0);
  });

  it('drops entries the server rejects as applied or obsolete', async () => {
    const store = memoryStore([entry('a', 1), entry('b', 2), entry('c', 3)]);
    const result = await drainQueue(store, async (e) =>
      e.clientId === 'b'
        ? { ok: false, status: 404, networkFailure: false }
        : { ok: true, status: 200, networkFailure: false },
    );
    expect(result).toEqual({ replayed: 2, dropped: 1, remaining: 0 });
  });

  it('stops at the first network failure and keeps the remainder in order', async () => {
    const store = memoryStore([entry('a', 1), entry('b', 2), entry('c', 3)]);
    const result = await drainQueue(store, async (e) =>
      e.clientId === 'b'
        ? { ok: false, status: 0, networkFailure: true }
        : { ok: true, status: 200, networkFailure: false },
    );
    expect(result.replayed).toBe(1);
    expect(result.remaining).toBe(2);
    expect((await store.all()).map((e) => e.clientId)).toEqual(['b', 'c']);
  });

  it('stops when the server keeps erroring with 5xx (§4.7 queued state)', async () => {
    const store = memoryStore([entry('a', 1), entry('b', 2)]);
    const result = await drainQueue(store, async () => ({
      ok: false,
      status: 500,
      networkFailure: false,
    }));
    expect(result.replayed).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it('a 4xx that is not applied-or-obsolete stops the drain (e.g. 401/429)', async () => {
    const store = memoryStore([entry('a', 1), entry('b', 2)]);
    const result = await drainQueue(store, async () => ({
      ok: false,
      status: 401,
      networkFailure: false,
    }));
    expect(result.remaining).toBe(2);
  });
});

describe('queue count pub-sub (§8.7 banner)', () => {
  it('notifies subscribers on change and supports unsubscribe', async () => {
    setQueueCount(0);
    const seen: number[] = [];
    const unsubscribe = subscribeQueueCount(() => seen.push(getQueueCount()));
    const store = memoryStore();
    await enqueueMutation(store, entry('a'));
    await enqueueMutation(store, entry('b'));
    await refreshQueueCount(store);
    await clearQueue(store);
    unsubscribe();
    await enqueueMutation(store, entry('c'));
    expect(seen).toEqual([1, 2, 0]);
    expect(getQueueCount()).toBe(1);
    setQueueCount(0);
  });
});
