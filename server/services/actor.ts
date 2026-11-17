import type { FastifyRequest } from 'fastify';
import { httpError } from '../plugins/errors.js';

/** Identity of the requester, resolved from the session cookie by the
 * auth hook (§7.6; ADR-0006). The pre-auth fallback that used to live here
 * was removed in P4 — every request is session-authed or 401. */
export interface ActorContext {
  readonly householdId: string;
  readonly memberId: string;
}

/** The auth hook guarantees a session on non-public routes; this makes that
 * guarantee explicit at each handler boundary (401 otherwise). */
export function requireActor(req: FastifyRequest): ActorContext {
  if (req.actor === undefined) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return req.actor;
}
