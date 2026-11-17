import type { FastifyInstance } from 'fastify';
import { httpError } from '../plugins/errors.js';
import { requireActor } from '../services/actor.js';
import { currentRevision } from '../services/changeLog.js';
import {
  changesSince,
  formatSseEvent,
  SSE_HEADERS,
  SSE_HEARTBEAT,
} from '../services/events.js';

export interface EventRoutesOptions {
  readonly pollMs?: number;
  readonly heartbeatMs?: number;
  readonly maxConnectionsPerSession?: number;
}

const DEFAULTS = {
  pollMs: 250, // NFR-7: propagation ≤1s
  heartbeatMs: 20_000, // §7.5
  maxConnectionsPerSession: 20, // §11
};

/** §7.5: GET /events?since=<revision> — SSE stream of change_log rows.
 * Reconnect uses Last-Event-ID (or since). Connections are counted per
 * session and capped (§11). */
export function eventRoutes(app: FastifyInstance, opts: EventRoutesOptions = {}): void {
  const pollMs = opts.pollMs ?? DEFAULTS.pollMs;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULTS.heartbeatMs;
  const maxConnections = opts.maxConnectionsPerSession ?? DEFAULTS.maxConnectionsPerSession;
  const connections = new Map<string, number>();

  app.get('/events', async (req, reply) => {
    const actor = requireActor(req);
    const open = connections.get(actor.memberId) ?? 0;
    if (open >= maxConnections) {
      throw httpError(429, 'RATE_LIMITED', 'Too many SSE connections.');
    }

    const raw = req.query as Record<string, unknown>;
    const sinceRaw = typeof raw.since === 'string' && raw.since !== '' ? Number(raw.since) : undefined;
    const lastEventId = req.headers['last-event-id'];
    const since =
      sinceRaw ??
      (typeof lastEventId === 'string' && lastEventId !== '' && Number.isFinite(Number(lastEventId))
        ? Number(lastEventId)
        : currentRevision(app.db));

    connections.set(actor.memberId, open + 1);
    const decrement = (): void => {
      const current = connections.get(actor.memberId) ?? 0;
      if (current <= 1) connections.delete(actor.memberId);
      else connections.set(actor.memberId, current - 1);
    };

    reply.hijack();
    const raw2 = reply.raw;
    raw2.writeHead(200, SSE_HEADERS);
    // Headers must reach the client immediately — writeHead alone buffers
    // until the first body write, and an idle stream has none for up to
    // heartbeatMs.
    raw2.flushHeaders();

    let last = since;
    const write = (chunk: string): boolean => raw2.write(chunk);
    for (const change of changesSince(app.db, last)) {
      write(formatSseEvent(change));
      last = change.revision;
    }

    const poll = setInterval(() => {
      try {
        for (const change of changesSince(app.db, last)) {
          write(formatSseEvent(change));
          last = change.revision;
        }
      } catch {
        // The db is closing or the socket is gone; close cleans up.
        cleanup();
      }
    }, pollMs);
    const heartbeat = setInterval(() => write(SSE_HEARTBEAT), heartbeatMs);

    function cleanup(): void {
      clearInterval(poll);
      clearInterval(heartbeat);
      decrement();
      if (!raw2.writableEnded) raw2.end();
    }

    req.raw.on('close', cleanup);
    raw2.on('close', cleanup);
  });
}
