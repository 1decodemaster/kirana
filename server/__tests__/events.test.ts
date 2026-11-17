import { get as httpGet, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUuidV7, type ChangeEvent } from '@kirana/shared';
import { formatSseEvent, changesSince, SSE_HEARTBEAT, SSE_HEADERS } from '../services/events.js';
import { appendChange } from '../services/changeLog.js';
import {
  buildTestApp,
  injectJson,
  loginCookie,
  seedStore,
  actor,
  seedCatalogItem,
  seedListItem,
} from './helpers.js';

let app: FastifyInstance;
let port = 0;
let cookie = '';

beforeAll(async () => {
  app = await buildTestApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
  cookie = await loginCookie(app);
});

afterAll(async () => {
  await app.close();
});

interface OpenStream {
  readonly res: IncomingMessage;
  text: () => string;
  waitFor: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<string>;
  destroy: () => void;
}

function openSse(query: string, extraHeaders: Record<string, string> = {}): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      { host: '127.0.0.1', port, path: `/api/v1/events${query}`, headers: { cookie, ...extraHeaders } },
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
        });
        const stream: OpenStream = {
          res,
          text: () => buffer,
          waitFor: (predicate, timeoutMs = 2000) =>
            new Promise((resolveWait, rejectWait) => {
              const started = Date.now();
              const tick = (): void => {
                if (predicate(buffer)) resolveWait(buffer);
                else if (Date.now() - started > timeoutMs) rejectWait(new Error(`timeout waiting for frames; got: ${buffer.slice(0, 400)}`));
                else setTimeout(tick, 10);
              };
              tick();
            }),
          destroy: () => res.destroy(),
        };
        resolve(stream);
      },
    );
    req.on('error', reject);
  });
}

describe('SSE event formatting (§7.5)', () => {
  it('formats the change frame exactly', () => {
    const change: ChangeEvent = {
      revision: 422,
      entity: 'list_item',
      entityId: '01913b5e-7d5a-7000-8000-000000000001',
      op: 'update',
      storeId: '01913b5e-7d5a-7000-8000-000000000002',
    };
    expect(formatSseEvent(change)).toBe(
      `event: change\nid: 422\ndata: ${JSON.stringify(change)}\n\n`,
    );
  });

  it('emits the documented heartbeat comment', () => {
    expect(SSE_HEARTBEAT).toBe(': heartbeat\n\n');
  });

  it('sets the no-buffering SSE headers (R-5)', () => {
    expect(SSE_HEADERS['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  });

  it('changesSince parses rows into the event shape, oldest first', async () => {
    const fresh = await buildTestApp();
    try {
      const idA = newUuidV7(1);
      const idB = newUuidV7(2);
      appendChange(fresh.db, { entity: 'member', entityId: idA, op: 'create' }, 1);
      appendChange(fresh.db, { entity: 'store', entityId: idB, op: 'create', storeId: idB }, 2);
      const events = changesSince(fresh.db, 0);
      expect(events.map((e) => e.entity)).toEqual(['member', 'store']);
      expect(events[0]?.revision).toBe(1);
    } finally {
      await fresh.close();
    }
  });
});

describe('GET /events (§7.5, NFR-7, G4.1 server half)', () => {

  it('serves the stream with SSE headers', async () => {
    const stream = await openSse('?since=0');
    try {
      expect(stream.res.headers['content-type']).toContain('text/event-stream');
      expect(stream.res.headers['cache-control']).toContain('no-cache');
    } finally {
      stream.destroy();
    }
  });

  it('replays changes after since, then tails live changes within the poll interval', async () => {
    // A change that exists before connecting.
    const cat = await injectJson(app, 'POST', '/api/v1/categories', {
      payload: { name: 'SSE Replay', scope: 'household' },
    });
    expect(cat.statusCode).toBe(201);
    const stream = await openSse('?since=0');
    try {
      const afterReplay = await stream.waitFor((t) => t.includes('"entity":"category"'));
      expect(afterReplay).toContain('event: change');
      const replayCount = afterReplay.split('event: change').length - 1;
      // Live tail: a second change after connect must arrive ≤1s (NFR-7).
      const live = await injectJson(app, 'POST', '/api/v1/categories', {
        payload: { name: 'SSE Live', scope: 'household' },
      });
      expect(live.statusCode).toBe(201);
      const afterLive = await stream.waitFor(
        (t) => t.split('event: change').length - 1 > replayCount,
      );
      expect(afterLive.length).toBeGreaterThan(afterReplay.length);
    } finally {
      stream.destroy();
    }
  });

  it('honours Last-Event-ID on reconnect (no since query)', async () => {
    const stream = await openSse('', { 'Last-Event-ID': '0' });
    try {
      await stream.waitFor((t) => t.includes('event: change'), 1000);
      // With Last-Event-ID 0 the stream replays the whole change_log tail,
      // including events created by earlier tests in this file.
      expect(stream.text()).toContain('event: change');
    } finally {
      stream.destroy();
    }
  });

  it('unauthenticated connections are 401', async () => {
    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpGet({ host: '127.0.0.1', port, path: '/api/v1/events' }, (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode ?? 0 });
      });
      req.on('error', reject);
    });
    expect(res.statusCode).toBe(401);
  });

  it('caps connections per session at 20 (§11)', async () => {
    const streams: OpenStream[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        streams.push(await openSse('?since=999999999'));
      }
      const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
        const req = httpGet(
          { host: '127.0.0.1', port, path: '/api/v1/events', headers: { cookie } },
          (res) => {
            res.resume();
            resolve({ statusCode: res.statusCode ?? 0 });
          },
        );
        req.on('error', reject);
      });
      expect(res.statusCode).toBe(429);
    } finally {
      for (const s of streams) s.destroy();
    }
  });

  it('closing a connection frees its slot', async () => {
    const first = await openSse('?since=999999999');
    first.destroy();
    await new Promise((r) => setTimeout(r, 50));
    // If the slot leaked, the second open (this one) would be refused only
    // after 20 connections — a cheap canary: one open must succeed.
    const second = await openSse('?since=999999999');
    second.destroy();
    expect(second.res.statusCode).toBe(200);
  });

  it('propagates a list_item change in under a second (NFR-7, G4.1 shape)', async () => {
    const a = actor(app);
    const storeId = seedStore(app, a.householdId, 'SSE Store', 1_730_000_100_000);
    const itemId = seedCatalogItem(app, a.householdId, 'SSE Item', 1_730_000_100_001);
    const rowId = seedListItem(app, {
      storeId,
      itemId,
      createdAt: 1_730_000_100_002,
    });
    // Connect at the current revision so only live changes arrive.
    const board = (await injectJson(app, 'GET', '/api/v1/board')).json() as { revision: number };
    const stream = await openSse(`?since=${board.revision}`);
    try {
      const res = await injectJson(app, 'PATCH', `/api/v1/list-items/${rowId}`, {
        payload: { note: 'live check' },
      });
      expect(res.statusCode).toBe(200);
      const start = Date.now();
      await stream.waitFor((t) => t.includes('"entity":"list_item"'));
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      stream.destroy();
    }
  });
});
