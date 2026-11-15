import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
  }
}

export interface DbPluginOptions {
  readonly database: Database.Database;
}

async function dbPlugin(app: FastifyInstance, opts: DbPluginOptions): Promise<void> {
  app.decorate('db', opts.database);
  app.addHook('onClose', async () => {
    opts.database.close();
  });
}

export default fp(dbPlugin, { name: 'kirana-db' });
