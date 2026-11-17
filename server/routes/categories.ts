import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  categoriesResponseSchema,
  createCategoryRequestSchema,
  deletedResponseSchema,
  updateCategoryRequestSchema,
  uuidSchema,
} from '@kirana/shared';
import { categoriesWithUsage, createCategory, deleteCategory, updateCategory } from '../services/categories.js';
import { parseRequest } from '../validate.js';
import { requireActor } from '../services/actor.js';

const idParams = z.object({ id: uuidSchema });

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (req) => {
    const actor = requireActor(req);
    const categories = categoriesWithUsage(app.db, actor.householdId);
    return categoriesResponseSchema.parse({ categories });
  });

  app.post('/categories', async (req, reply) => {
    const actor = requireActor(req);
    const input = parseRequest(createCategoryRequestSchema, req.body);
    const body = createCategory(app.db, actor, input, Date.now());
    return reply.code(201).send(body);
  });

  app.patch('/categories/:id', async (req) => {
    const actor = requireActor(req);
    const { id } = parseRequest(idParams, req.params);
    const patch = parseRequest(updateCategoryRequestSchema, req.body);
    return updateCategory(app.db, actor, id, patch, Date.now());
  });

  app.delete('/categories/:id', async (req) => {
    const actor = requireActor(req);
    const { id } = parseRequest(idParams, req.params);
    return deletedResponseSchema.parse(deleteCategory(app.db, actor, id, Date.now()));
  });
}
