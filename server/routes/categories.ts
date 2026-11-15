import type { FastifyInstance } from 'fastify';
import { categoriesResponseSchema } from '@kirana/shared';
import { categoriesWithUsage } from '../services/categories.js';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (req) => {
    const categories = categoriesWithUsage(app.db, req.actor.householdId);
    return categoriesResponseSchema.parse({ categories });
  });
}
