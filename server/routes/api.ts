import type { FastifyInstance } from 'fastify';
import { registerAuth } from '../plugins/auth.js';
import { httpError } from '../plugins/errors.js';
import { authRoutes } from './auth.js';
import { boardRoutes } from './board.js';
import { storeRoutes } from './stores.js';
import { listItemRoutes } from './listItems.js';
import { itemRoutes } from './items.js';
import { categoryRoutes } from './categories.js';
import { importExportRoutes } from './importExport.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ApiRoutesOptions {
  readonly dataDir: string;
  readonly backupKeepDaily: number;
  readonly sessionSecret: string;
  readonly appOrigin: string;
}

// Deliberately NOT fastify-plugin: the CSRF + auth hooks and the request
// decoration must stay scoped to /api/v1 and not leak onto /healthz or the
// static SPA routes. Hooks added here apply to this scope and its children.
export async function apiRoutes(app: FastifyInstance, opts: ApiRoutesOptions): Promise<void> {
  // §7.1: mutations require X-Requested-With: kirana (defense in depth
  // alongside SameSite=Lax).
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers['x-requested-with'] !== 'kirana') {
      throw httpError(403, 'FORBIDDEN', 'Missing X-Requested-With: kirana header');
    }
  });

  // §7.6 (P4): session auth — default-deny 401 on every non-public route,
  // per-session mutation rate limit (§11). Replaces the pre-auth actor stub.
  registerAuth(app, { sessionSecret: opts.sessionSecret, appOrigin: opts.appOrigin });

  await app.register(authRoutes);
  await app.register(boardRoutes);
  await app.register(storeRoutes);
  await app.register(listItemRoutes);
  await app.register(itemRoutes);
  await app.register(categoryRoutes);
  await app.register(importExportRoutes, {
    dataDir: opts.dataDir,
    backupKeepDaily: opts.backupKeepDaily,
    sessionSecret: opts.sessionSecret,
  });
}
