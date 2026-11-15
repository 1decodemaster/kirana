import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { healthResponseSchema } from '@kirana/shared';
import type { AppConfig } from './config.js';
import errorsPlugin from './plugins/errors.js';

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

  if (config.webDistDir !== undefined) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      wildcard: true,
      index: 'index.html',
    });
  }

  await app.register(errorsPlugin, { spaIndex: config.webDistDir !== undefined });

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
