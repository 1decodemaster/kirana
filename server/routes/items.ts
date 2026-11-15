import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createAliasRequestSchema,
  createItemRequestSchema,
  deletedResponseSchema,
  getItemResponseSchema,
  getItemsQuerySchema,
  mergeItemsRequestSchema,
  updateItemRequestSchema,
  uuidSchema,
} from '@kirana/shared';
import { createCatalogItem, searchItems } from '../services/catalog.js';
import {
  createAlias,
  deleteAlias,
  deleteItem,
  getItem,
  mergeItems,
  updateItem,
} from '../services/items.js';
import { parseRequest } from '../validate.js';

const idParams = z.object({ id: uuidSchema });
const aliasParams = z.object({ id: uuidSchema, aliasId: uuidSchema });

/** Query params arrive as strings; coerce the numeric ones before Zod. */
function parseItemsQuery(req: FastifyRequest): ReturnType<typeof getItemsQuerySchema.parse> {
  const raw = req.query as Record<string, unknown>;
  const limit = raw['limit'];
  return parseRequest(getItemsQuerySchema, {
    ...(typeof raw['q'] === 'string' ? { q: raw['q'] } : {}),
    ...(typeof raw['categoryId'] === 'string' ? { categoryId: raw['categoryId'] } : {}),
    ...(typeof raw['storeId'] === 'string' ? { storeId: raw['storeId'] } : {}),
    ...(typeof limit === 'string' && limit.length > 0 ? { limit: Number(limit) } : {}),
    ...(typeof raw['cursor'] === 'string' ? { cursor: raw['cursor'] } : {}),
  });
}

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/items', async (req) => {
    const query = parseItemsQuery(req);
    return searchItems(app.db, req.actor.householdId, query, Date.now());
  });

  app.post('/items', async (req, reply) => {
    const input = parseRequest(createItemRequestSchema, req.body);
    const { body, created } = createCatalogItem(app.db, req.actor, input, Date.now());
    return reply.code(created ? 201 : 200).send(body);
  });

  app.get('/items/:id', async (req) => {
    const { id } = parseRequest(idParams, req.params);
    return getItemResponseSchema.parse(getItem(app.db, req.actor, id));
  });

  app.patch('/items/:id', async (req) => {
    const { id } = parseRequest(idParams, req.params);
    const patch = parseRequest(updateItemRequestSchema, req.body);
    return updateItem(app.db, req.actor, id, patch, Date.now());
  });

  app.delete('/items/:id', async (req) => {
    const { id } = parseRequest(idParams, req.params);
    return deletedResponseSchema.parse(deleteItem(app.db, req.actor, id, Date.now()));
  });

  app.post('/items/:id/aliases', async (req, reply) => {
    const { id } = parseRequest(idParams, req.params);
    const input = parseRequest(createAliasRequestSchema, req.body);
    const { alias, created } = createAlias(app.db, req.actor, id, input, Date.now());
    return reply.code(created ? 201 : 200).send({ alias });
  });

  app.delete('/items/:id/aliases/:aliasId', async (req) => {
    const { id, aliasId } = parseRequest(aliasParams, req.params);
    return deletedResponseSchema.parse(deleteAlias(app.db, req.actor, id, aliasId, Date.now()));
  });

  app.post('/items/merge', async (req) => {
    const input = parseRequest(mergeItemsRequestSchema, req.body);
    return mergeItems(app.db, req.actor, input, Date.now());
  });
}
