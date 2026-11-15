import type { FastifyInstance } from 'fastify';
import { httpError } from '../plugins/errors.js';
import { resolveActor, type ActorContext } from '../services/actor.js';
import { boardRoutes } from './board.js';
import { storeRoutes } from './stores.js';
import { listItemRoutes } from './listItems.js';
import { itemRoutes } from './items.js';
import { categoryRoutes } from './categories.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Deliberately NOT fastify-plugin: the CSRF + actor hooks and the request
// decoration must stay scoped to /api/v1 and not leak onto /healthz or the
// static SPA routes. Hooks added here apply to this scope and its children.
export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // §7.1: mutations require X-Requested-With: kirana (defense in depth
  // alongside SameSite=Lax; meaningful once auth lands in P4).
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers['x-requested-with'] !== 'kirana') {
      throw httpError(403, 'FORBIDDEN', 'Missing X-Requested-With: kirana header');
    }
  });

  // Pre-auth actor (P1): first household + its oldest member act on every
  // API request. Replaced by session auth in P4 (§7.6).
  app.decorateRequest('actor');
  app.addHook('onRequest', async (req) => {
    req.actor = resolveActor(app.db, Date.now());
  });

  await app.register(boardRoutes);
  await app.register(storeRoutes);
  await app.register(listItemRoutes);
  await app.register(itemRoutes);
  await app.register(categoryRoutes);
}
