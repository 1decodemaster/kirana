import type { FastifyInstance } from 'fastify';
import { bulkCheckRequestSchema, patchListItemRequestSchema } from '@kirana/shared';
import { bulkCheck, deleteListItem, patchListItem } from '../services/listItems.js';
import { parseRequest } from '../validate.js';
import { idParam } from './board.js';

export async function listItemRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/list-items/:id', async (req) => {
    const id = idParam(req.params);
    const patch = parseRequest(patchListItemRequestSchema, req.body);
    return patchListItem(app.db, req.actor, id, patch, Date.now());
  });

  app.delete('/list-items/:id', async (req) => {
    const id = idParam(req.params);
    return deleteListItem(app.db, req.actor, id, Date.now());
  });

  app.post('/list-items/bulk-check', async (req) => {
    const input = parseRequest(bulkCheckRequestSchema, req.body);
    return bulkCheck(app.db, req.actor, input.ids, input.checked, Date.now());
  });
}
