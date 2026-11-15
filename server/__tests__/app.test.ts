import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  errorResponseSchema,
  healthResponseSchema,
  type ErrorCode,
} from '@kirana/shared';
import { buildApp } from '../app.js';
import { ConfigError, loadConfig, type AppConfig } from '../config.js';
import { httpError } from '../plugins/errors.js';
import { startJobsWorker } from '../jobs/worker.js';
import { MIGRATIONS_DIR } from './helpers.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    dataDir: '/tmp',
    databaseUrl: ':memory:',
    migrationsDir: MIGRATIONS_DIR,
    appOrigin: 'http://localhost:8080',
    sessionSecret: 'test-secret',
    logLevel: 'fatal',
    webDistDir: undefined,
    version: '0.1.0',
    revision: 'testrev',
    ...overrides,
  };
}

let app: FastifyInstance;
let staticDir: string;

beforeEach(async () => {
  app = await buildApp(makeConfig());
  await app.ready();
});

afterAll(async () => {
  if (staticDir !== undefined) rmSync(staticDir, { recursive: true, force: true });
});

describe('GET /healthz (G0.1 contract)', () => {
  it('returns 200 with version, revision, uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.revision).toBe('testrev');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('carries X-Request-Id on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('honors an incoming X-Request-Id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'req-abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('req-abc-123');
  });
});

describe('error envelope (PRD §7.1)', () => {
  it('maps unknown routes to NOT_FOUND with the envelope shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps thrown httpError codes into the envelope', async () => {
    const testApp = await buildApp(makeConfig());
    testApp.get('/boom', async () => {
      throw httpError(409, 'STORE_NOT_EMPTY', 'This store still has items.');
    });
    await testApp.ready();
    const res = await testApp.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('STORE_NOT_EMPTY');
    await testApp.close();
  });

  it('does not leak internals on 500', async () => {
    const testApp = await buildApp(makeConfig());
    testApp.get('/crash', async () => {
      throw new Error('super-secret stack detail');
    });
    await testApp.ready();
    const res = await testApp.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('super-secret');
    await testApp.close();
  });

  it('rejects malformed JSON with VALIDATION_FAILED', async () => {
    const testApp = await buildApp(makeConfig());
    testApp.post('/echo', async (req) => req.body);
    await testApp.ready();
    const res = await testApp.inject({
      method: 'POST',
      url: '/echo',
      payload: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_FAILED');
    await testApp.close();
  });
});

describe('static SPA serving when webDistDir is set', () => {
  beforeEach(async () => {
    staticDir = mkdtempSync(path.join(tmpdir(), 'kirana-web-'));
    mkdirSync(path.join(staticDir, 'assets'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>kirana</title>');
    writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
    await app.close();
    app = await buildApp(makeConfig({ webDistDir: staticDir }));
    await app.ready();
  });

  it('serves index.html at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('kirana');
  });

  it('serves asset files', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('console.log');
  });

  it('falls back to index.html for SPA deep links (HTML accept)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/store/01913b5e-7d5a-7000-8000-000000000001',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('kirana');
  });

  it('keeps JSON 404s for API-looking paths', async () => {
    // /api/v1/board exists since P1; assert on a route that does not.
    const res = await app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('loadConfig', () => {
  it('applies §12.1 defaults and resolves version', () => {
    const config = loadConfig({
      SESSION_SECRET: 's',
      WEB_DIST_DIR: '',
      KIRANA_REVISION: 'abc1234',
    } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe('/data');
    expect(config.databaseUrl).toBe('/data/kirana.db');
    expect(config.appOrigin).toBe('http://localhost:8080');
    expect(config.logLevel).toBe('info');
    expect(config.revision).toBe('abc1234');
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('requires SESSION_SECRET (§12.1)', () => {
    expect(() => loadConfig({ WEB_DIST_DIR: '' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('validates PORT and LOG_LEVEL', () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: 's', WEB_DIST_DIR: '', PORT: '99999' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ SESSION_SECRET: 's', WEB_DIST_DIR: '', LOG_LEVEL: 'loud' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });
});

describe('jobs worker stub (PRD §13)', () => {
  it('logs "no jobs" on its interval and stops cleanly', () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const logger = { info: (msg: string) => logs.push(msg) };
    const worker = startJobsWorker(logger, 1000);
    vi.advanceTimersByTime(2500);
    expect(logs).toEqual(['jobs worker started (P6 stub)', 'no jobs', 'no jobs']);
    worker.stop();
    vi.advanceTimersByTime(5000);
    expect(logs).toHaveLength(3);
    vi.useRealTimers();
  });
});

describe('error code coverage', () => {
  it('falls back to status-code mapping when the thrown error has no contract code', async () => {
    const cases: Array<[number, ErrorCode]> = [
      [400, 'VALIDATION_FAILED'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT_STALE'],
      [429, 'RATE_LIMITED'],
      [500, 'INTERNAL'],
    ];
    const testApp = await buildApp(makeConfig());
    for (const [status] of cases) {
      testApp.get(`/status/${status}`, async () => {
        throw Object.assign(new Error('plain error'), { statusCode: status });
      });
    }
    await testApp.ready();
    for (const [status, code] of cases) {
      const res = await testApp.inject({ method: 'GET', url: `/status/${status}` });
      expect(res.statusCode).toBe(status);
      expect((errorResponseSchema.parse(res.json()).error as { code: ErrorCode }).code).toBe(code);
    }
    await testApp.close();
  });
});
