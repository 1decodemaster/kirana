import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { healthResponseSchema } from '@kirana/shared';
import type { AppConfig } from './config.js';
import errorsPlugin from './plugins/errors.js';
import dbPlugin from './plugins/db.js';
import { apiRoutes } from './routes/api.js';
import { openAppDatabase } from './db.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    },
    logger: { level: config.logLevel },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(sensible);

  // Registered before any routes so every subtree inherits the §7.1 envelope.
  await app.register(errorsPlugin, { spaIndex: config.webDistDir !== undefined });

  const database = openAppDatabase(config);
  await app.register(dbPlugin, { database });
  await app.register(apiRoutes, {
    prefix: '/api/v1',
    dataDir: config.dataDir,
    backupKeepDaily: config.backupKeepDaily,
    sessionSecret: config.sessionSecret,
    appOrigin: config.appOrigin,
    loginRateLimit: config.loginRateLimit,
    mutationRateLimit: config.mutationRateLimit,
  });

  if (config.webDistDir !== undefined) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      wildcard: true,
      index: 'index.html',
    });
  }

  app.get('/healthz', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      version: config.version,
      revision: config.revision,
      uptime: process.uptime(),
    });
  });

  return app;
}
