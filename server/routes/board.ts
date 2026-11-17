import type { FastifyInstance } from 'fastify';
import { boardQuerySchema, uuidSchema } from '@kirana/shared';
import { buildBoard } from '../services/board.js';
import { requireActor } from '../services/actor.js';
import { parseRequest } from '../validate.js';

export async function boardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/board', async (req) => {
    const actor = requireActor(req);
    const raw = req.query as Record<string, unknown>;
    const sinceRaw = typeof raw.since === 'string' ? Number(raw.since) : undefined;
    const query = parseRequest(boardQuerySchema, { since: sinceRaw });
    return buildBoard(app.db, actor, { since: query.since });
  });
}

export function idParam(raw: unknown): string {
  const { id } = raw as { id: unknown };
  return parseRequest(uuidSchema, id);
}
