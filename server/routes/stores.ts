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
import { requireActor } from '../services/actor.js';

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/stores', async (req, reply) => {
    const actor = requireActor(req);
    const input = parseRequest(createStoreRequestSchema, req.body);
    const result = createStore(app.db, actor, input, Date.now());
    return reply.code(201).send(result);
  });

  app.post('/stores/:id/items', async (req, reply) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    const input = parseRequest(addListItemRequestSchema, req.body);
    // §7.4 + ADR-0007: 201 = created; 200 = replayed or merged into the
    // store's existing active row.
    const { body, replayed, merged } = addListItem(app.db, actor, id, input, Date.now());
    return reply.code(replayed || merged ? 200 : 201).send(body);
  });

  app.patch('/stores/:id', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    const patch = parseRequest(updateStoreRequestSchema, req.body);
    return updateStore(app.db, actor, id, patch, Date.now());
  });

  app.delete('/stores/:id', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    const result = deleteStore(app.db, actor, id, Date.now());
    return deletedResponseSchema.parse(result);
  });

  app.post('/stores/:id/clear-bought', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    return clearBought(app.db, actor, id, Date.now());
  });

  app.post('/stores/:id/done', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    return markStoreDone(app.db, actor, id, Date.now());
  });

  app.post('/stores/:id/reopen', async (req) => {
    const actor = requireActor(req);
    const id = idParam(req.params);
    return reopenStore(app.db, actor, id, Date.now());
  });
}
