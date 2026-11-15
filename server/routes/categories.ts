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

const idParams = z.object({ id: uuidSchema });

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (req) => {
    const categories = categoriesWithUsage(app.db, req.actor.householdId);
    return categoriesResponseSchema.parse({ categories });
  });

  app.post('/categories', async (req, reply) => {
    const input = parseRequest(createCategoryRequestSchema, req.body);
    const body = createCategory(app.db, req.actor, input, Date.now());
    return reply.code(201).send(body);
  });

  app.patch('/categories/:id', async (req) => {
    const { id } = parseRequest(idParams, req.params);
    const patch = parseRequest(updateCategoryRequestSchema, req.body);
    return updateCategory(app.db, req.actor, id, patch, Date.now());
  });

  app.delete('/categories/:id', async (req) => {
    const { id } = parseRequest(idParams, req.params);
    return deletedResponseSchema.parse(deleteCategory(app.db, req.actor, id, Date.now()));
  });
}
