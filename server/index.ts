import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { startJobsWorker, type JobsWorker } from './jobs/worker.js';

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);
  const worker: JobsWorker = startJobsWorker(app.log);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    worker.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return undefined;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void startServer();
}
