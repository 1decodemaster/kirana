import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearQueue, drainQueue, refreshQueueCount, type QueueStore } from '../lib/offline.js';
import type { QueueEntry } from '../lib/queueTypes.js';

function memoryStore(): QueueStore {
  const rows = new Map<string, QueueEntry>();
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

describe('queue replay discipline (G4.2/G4.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays oldest-first over real fetch and clears the queue', async () => {
    const store = memoryStore();
    await store.add({ clientId: 'q1', method: 'PATCH', path: '/api/v1/list-items/a', createdAt: 1 });
    await store.add({ clientId: 'q2', method: 'POST', path: '/api/v1/stores/s/items', createdAt: 2 });
    const calls: Array<{ path: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        calls.push({ path, init });
        return new Response('{}', { status: 200 });
      }),
    );
    const result = await drainQueue(store, async (entry) => {
      const response = await fetch(entry.path, {
        method: entry.method,
        headers: { 'x-requested-with': 'kirana' },
      });
      return { ok: response.ok, status: response.status, networkFailure: false };
    });
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/list-items/a', '/api/v1/stores/s/items']);
    expect(calls[0]?.init.headers).toMatchObject({ 'x-requested-with': 'kirana' });
    expect(result).toEqual({ replayed: 2, dropped: 0, remaining: 0 });
    await refreshQueueCount(store);
  });

  it('a network failure mid-drain preserves order for the next attempt', async () => {
    const store = memoryStore();
    await store.add({ clientId: 'q1', method: 'PATCH', path: '/api/v1/list-items/a', createdAt: 1 });
    await store.add({ clientId: 'q2', method: 'PATCH', path: '/api/v1/list-items/b', createdAt: 2 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (String(path).endsWith('/b')) throw new TypeError('network gone');
        return new Response('{}', { status: 200 });
      }),
    );
    const result = await drainQueue(store, async (entry) => {
      try {
        const response = await fetch(entry.path, { method: entry.method });
        return { ok: response.ok, status: response.status, networkFailure: false };
      } catch {
        return { ok: false, status: 0, networkFailure: true };
      }
    });
    expect(result.replayed).toBe(1);
    expect(result.remaining).toBe(1);
    await clearQueue(store);
  });
});
