import type { FastifyInstance } from 'fastify';
import { bulkCheckRequestSchema, patchListItemRequestSchema } from '@kirana/shared';
import { bulkCheck, deleteListItem, patchListItem } from '../services/listItems.js';
import { parseRequest } from '../validate.js';
import { idParam } from './board.js';
import { requireActor } from '../services/actor.js';

export async function listItemRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/list-items/:id', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    const patch = parseRequest(patchListItemRequestSchema, req.body);
    return patchListItem(app.db, actor, id, patch, Date.now());
  });

  app.delete('/list-items/:id', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    return deleteListItem(app.db, actor, id, Date.now());
  });

  app.post('/list-items/bulk-check', async (req) => {
    const actor = requireActor(req);
    const input = parseRequest(bulkCheckRequestSchema, req.body);
    return bulkCheck(app.db, actor, input.ids, input.checked, Date.now());
  });
}
