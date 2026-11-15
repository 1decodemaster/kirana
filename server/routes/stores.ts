import type { FastifyInstance } from 'fastify';
import {
  addListItemRequestSchema,
  createStoreRequestSchema,
  deletedResponseSchema,
  updateStoreRequestSchema,
} from '@kirana/shared';
import { addListItem } from '../services/catalog.js';
import {
  clearBought,
  createStore,
  deleteStore,
  markStoreDone,
  reopenStore,
  updateStore,
} from '../services/stores.js';
import { parseRequest } from '../validate.js';
import { idParam } from './board.js';

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/stores', async (req, reply) => {
    const input = parseRequest(createStoreRequestSchema, req.body);
    const result = createStore(app.db, req.actor, input, Date.now());
    return reply.code(201).send(result);
  });

  app.post('/stores/:id/items', async (req, reply) => {
    const id = idParam(req.params);
    const input = parseRequest(addListItemRequestSchema, req.body);
    const { body, replayed } = addListItem(app.db, req.actor, id, input, Date.now());
    return reply.code(replayed ? 200 : 201).send(body);
  });

  app.patch('/stores/:id', async (req) => {
    const id = idParam(req.params);
    const patch = parseRequest(updateStoreRequestSchema, req.body);
    return updateStore(app.db, req.actor, id, patch, Date.now());
  });

  app.delete('/stores/:id', async (req) => {
    const id = idParam(req.params);
    const result = deleteStore(app.db, req.actor, id, Date.now());
    return deletedResponseSchema.parse(result);
  });

  app.post('/stores/:id/clear-bought', async (req) => {
    const id = idParam(req.params);
    return clearBought(app.db, req.actor, id, Date.now());
  });

  app.post('/stores/:id/done', async (req) => {
    const id = idParam(req.params);
    return markStoreDone(app.db, req.actor, id, Date.now());
  });

  app.post('/stores/:id/reopen', async (req) => {
    const id = idParam(req.params);
    return reopenStore(app.db, req.actor, id, Date.now());
  });
}
