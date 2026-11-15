import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface AppConfig {
  readonly port: number;
  readonly dataDir: string;
  readonly databaseUrl: string;
  readonly migrationsDir: string;
  readonly appOrigin: string;
  readonly sessionSecret: string;
  readonly logLevel: LogLevel;
  readonly webDistDir: string | undefined;
  readonly version: string;
  readonly revision: string;
}

const LOG_LEVELS: ReadonlySet<string> = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = parsePort(env.PORT);
  const dataDir = env.DATA_DIR ?? '/data';
  const databaseUrl = env.DATABASE_URL ?? `${dataDir}/kirana.db`;
  const appOrigin = env.APP_ORIGIN ?? 'http://localhost:8080';
  const sessionSecret = env.SESSION_SECRET;
  if (sessionSecret === undefined || sessionSecret.length === 0) {
    throw new ConfigError('SESSION_SECRET is required (see .env.example)');
  }
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.has(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}`);
  }
  return {
    port,
    dataDir,
    databaseUrl,
    migrationsDir: resolveMigrationsDir(env.KIRANA_MIGRATIONS_DIR),
    appOrigin,
    sessionSecret,
    logLevel: logLevel as LogLevel,
    webDistDir: resolveWebDistDir(env.WEB_DIST_DIR),
    version: readVersion(),
    revision: env.KIRANA_REVISION ?? 'dev',
  };
}

export class ConfigError extends Error {}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer in [1, 65535], got ${raw}`);
  }
  return port;
}

function resolveWebDistDir(override: string | undefined): string | undefined {
  if (override !== undefined && override.length > 0) {
    const abs = path.resolve(override);
    return existsSync(abs) ? abs : undefined;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../web/dist', '../../web/dist']) {
    const dir = path.resolve(here, rel);
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

function resolveMigrationsDir(override: string | undefined): string {
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../db/migrations', '../../db/migrations', '../../../db/migrations']) {
    const dir = path.resolve(here, rel);
    if (existsSync(dir)) return dir;
  }
  throw new ConfigError('migrations directory not found (set KIRANA_MIGRATIONS_DIR)');
}

function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../package.json', '../../package.json']) {
    const file = path.resolve(here, rel);
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
      if (pkg.version !== undefined) return pkg.version;
    }
  }
  throw new ConfigError('package.json with a version was not found');
}
