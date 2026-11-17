import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { httpError } from './errors.js';
import type { ActorContext } from '../services/actor.js';
import { SessionStore } from '../services/sessions.js';
import { createRateLimiter, type RateLimiter } from '../services/rateLimit.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext | undefined;
  }
  interface FastifyInstance {
    auth: ServerAuth;
  }
}

export interface ServerAuth {
  readonly sessions: SessionStore;
  readonly loginLimiter: RateLimiter;
  readonly mutationLimiter: RateLimiter;
  readonly now: () => number;
  readonly appOrigin: string;
  cookieOptions(): CookieSerializeOptions;
}

export interface AuthPluginOptions {
  readonly sessionSecret: string;
  readonly appOrigin: string;
  readonly now?: () => number;
}

/** Routes reachable without a session (full paths; §7.6 + ADR-0005).
 * Everything else under /api/v1 is default-deny 401 UNAUTHORIZED. */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/members',
  'POST /api/v1/household',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function routeKey(req: FastifyRequest): string {
  const path = req.url.split('?')[0] ?? req.url;
  return `${req.method} ${path}`;
}

/** §7.6 + §11: session resolution, default-deny enforcement, per-session
 * mutation rate limit. Scoped to /api/v1 (registered inside apiRoutes). */
export function registerAuth(app: FastifyInstance, opts: AuthPluginOptions): void {
  const now = opts.now ?? Date.now;
  const auth: ServerAuth = {
    sessions: new SessionStore(app.db, opts.sessionSecret, now),
    loginLimiter: createRateLimiter(5, 5 * 60 * 1000, { escalate: true }),
    mutationLimiter: createRateLimiter(120, 60 * 1000),
    now,
    appOrigin: opts.appOrigin,
    cookieOptions() {
      return {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: opts.appOrigin.startsWith('https://'),
        maxAge: 2_592_000,
      };
    },
  };
  app.decorate('auth', auth);

  app.decorateRequest('actor', undefined);
  app.addHook('onRequest', async (req) => {
    const sid = req.cookies.sid;
    req.actor = auth.sessions.resolve(typeof sid === 'string' ? sid : undefined);

    const key = routeKey(req);
    if (req.actor === undefined && !PUBLIC_ROUTES.has(key)) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    if (req.actor !== undefined && !SAFE_METHODS.has(req.method) && !PUBLIC_ROUTES.has(key)) {
      // Record first, then check: the 121st mutation in a minute is blocked.
      auth.mutationLimiter.record(req.actor.memberId, now());
      const decision = auth.mutationLimiter.check(req.actor.memberId, now());
      if (!decision.allowed) {
        throw httpError(429, 'RATE_LIMITED', 'Too many requests.', {
          retryAfterMs: decision.retryAfterMs,
        });
      }
    }
  });
}
