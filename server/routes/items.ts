import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createItemRequestSchema, getItemsQuerySchema } from '@kirana/shared';
import { createCatalogItem, searchItems } from '../services/catalog.js';
import { parseRequest } from '../validate.js';

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
}
