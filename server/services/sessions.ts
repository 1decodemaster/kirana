import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '@kirana/db';
import type Database from 'better-sqlite3';
import type { ActorContext } from './actor.js';

/** §7.6: cookie Max-Age 2592000 s = 30 days. */
export const SESSION_TTL_MS = 2_592_000_000;
/** §11: SSE connections max 20/session — cache cap unrelated, but the
 * session cache is bounded for the same homelab-scale reason. */
const CACHE_MAX = 1000;

export interface SessionRecord {
  readonly id: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

interface CacheEntry {
  readonly householdId: string;
  readonly memberId: string;
  readonly expiresAt: number;
}

interface SessionRow {
  readonly id: string;
  readonly household_id: string;
  readonly member_id: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly revoked_at: number | null;
}

/** Signed opaque token: `<base64url(token)>.<base64url(HMAC(token))>`
 * (§7.6). The DB stores sha256(token) only (ADR-0006). */
export function signSessionToken(token: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(token).digest('base64url');
  return `${token}.${sig}`;
}

export function verifySessionToken(cookieValue: string, secret: string): string | undefined {
  const dot = cookieValue.indexOf('.');
  if (dot <= 0 || dot === cookieValue.length - 1) return undefined;
  const token = cookieValue.slice(0, dot);
  const sig = Buffer.from(cookieValue.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', secret).update(token).digest();
  if (sig.length !== expected.length) return undefined;
  return timingSafeEqual(sig, expected) ? token : undefined;
}

/**
 * The sessions table is the truth; a small per-process Map in front keeps
 * the hot path (board p95 ≤50ms, NFR-1) free of a session read. Logout
 * removes from both, so a restart degrades to table lookups only (G4.6).
 */
export class SessionStore {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: Database.Database,
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  async create(householdId: string, memberId: string): Promise<{ cookieValue: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    const id = sha256Hex(token);
    const at = this.now();
    const expiresAt = at + SESSION_TTL_MS;
    this.db
      .prepare(
        `INSERT INTO sessions (id, household_id, member_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, householdId, memberId, at, expiresAt);
    this.cacheSet(id, { householdId, memberId, expiresAt });
    return { cookieValue: signSessionToken(token, this.secret), expiresAt };
  }

  resolve(cookieValue: string | undefined): ActorContext | undefined {
    if (cookieValue === undefined || cookieValue.length === 0) return undefined;
    const token = verifySessionToken(cookieValue, this.secret);
    if (token === undefined) return undefined;
    const id = sha256Hex(token);
    const at = this.now();
    const cached = this.cache.get(id);
    if (cached !== undefined) {
      if (cached.expiresAt > at) {
        return { householdId: cached.householdId, memberId: cached.memberId };
      }
      this.cache.delete(id);
    }
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    if (
      row === undefined ||
      row.revoked_at !== null ||
      row.expires_at <= at
    ) {
      return undefined;
    }
    const member = this.db
      .prepare('SELECT 1 FROM members WHERE id = ? AND deleted_at IS NULL')
      .get(row.member_id);
    if (member === undefined) return undefined;
    this.cacheSet(id, {
      householdId: row.household_id,
      memberId: row.member_id,
      expiresAt: row.expires_at,
    });
    return { householdId: row.household_id, memberId: row.member_id };
  }

  revoke(cookieValue: string | undefined): void {
    if (cookieValue === undefined || cookieValue.length === 0) return;
    const token = verifySessionToken(cookieValue, this.secret);
    if (token === undefined) return;
    const id = sha256Hex(token);
    this.cache.delete(id);
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now(), id);
  }

  /** Called when a member is soft-deleted: their sessions are inert
   * immediately, cache included (the cache path cannot re-check the member
   * row without defeating the cache). */
  revokeAllForMember(memberId: string): void {
    for (const [id, entry] of this.cache) {
      if (entry.memberId === memberId) this.cache.delete(id);
    }
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL')
      .run(this.now(), memberId);
  }

  private cacheSet(id: string, entry: CacheEntry): void {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(id, entry);
  }
}
