import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  authMembersRequestSchema,
  createHouseholdRequestSchema,
  createMemberRequestSchema,
  loginRequestSchema,
  newUuidV7,
  updateHouseholdRequestSchema,
  updateMemberRequestSchema,
  uuidSchema,
  type MemberDto,
} from '@kirana/shared';
import { hashPasscode, seedCategories, seedHouseholdCatalog, verifyPasscode } from '@kirana/db';
import { httpError } from '../plugins/errors.js';
import { parseRequest } from '../validate.js';
import { appendChange } from '../services/changeLog.js';
import { requireActor } from '../services/actor.js';

interface HouseholdRow {
  readonly id: string;
  readonly name: string;
  readonly passcode_hash: string;
}

interface MemberRow {
  readonly id: string;
  readonly display_name: string;
  readonly color: string;
}

function toMemberDtoRow(row: MemberRow): MemberDto {
  return { id: row.id, displayName: row.display_name, color: row.color };
}

function firstHousehold(db: FastifyInstance['db']): HouseholdRow | undefined {
  return db
    .prepare('SELECT id, name, passcode_hash FROM households ORDER BY created_at, id LIMIT 1')
    .get() as HouseholdRow | undefined;
}

function activeMembers(db: FastifyInstance['db'], householdId: string): MemberRow[] {
  return db
    .prepare(
      `SELECT id, display_name, color FROM members
       WHERE household_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`,
    )
    .all(householdId) as MemberRow[];
}

function memberByName(
  db: FastifyInstance['db'],
  householdId: string,
  displayName: string,
): MemberRow | undefined {
  return db
    .prepare(
      `SELECT id, display_name, color FROM members
       WHERE household_id = ? AND display_name = ? AND deleted_at IS NULL
       ORDER BY created_at, id LIMIT 1`,
    )
    .get(householdId, displayName) as MemberRow | undefined;
}

function memberById(
  db: FastifyInstance['db'],
  householdId: string,
  id: string,
): MemberRow | undefined {
  return db
    .prepare(
      `SELECT id, display_name, color FROM members
       WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
    )
    .get(id, householdId) as MemberRow | undefined;
}

function requireUniqueName(
  db: FastifyInstance['db'],
  householdId: string,
  displayName: string,
  excludeMemberId?: string,
): void {
  const clash = memberByName(db, householdId, displayName);
  if (clash !== undefined && clash.id !== excludeMemberId) {
    throw httpError(400, 'VALIDATION_FAILED', 'A member with this name already exists.');
  }
}

function householdDto(row: HouseholdRow): { id: string; name: string } {
  return { id: row.id, name: row.name };
}

const idParamSchema = z.object({ id: uuidSchema });

/** §7.2 #1–3 + ADR-0005 additions: the wizard commit, household settings,
 * member management. Login and roster share the per-IP limiter. */
export function authRoutes(app: FastifyInstance): void {
  const auth = app.auth;
  const db = app.db;

  app.post('/auth/login', async (req, reply) => {
    const body = parseRequest(loginRequestSchema, req.body);
    const ip = req.ip;
    // Record first (blocked attempts feed the backoff), then check (§7.6).
    auth.loginLimiter.record(ip, auth.now());
    const decision = auth.loginLimiter.check(ip, auth.now());
    if (!decision.allowed) {
      throw httpError(429, 'RATE_LIMITED', 'Too many login attempts.', {
        retryAfterMs: decision.retryAfterMs,
      });
    }
    const household = firstHousehold(db);
    const passcodeOk =
      household !== undefined && (await verifyPasscode(body.passcode, household.passcode_hash));
    if (!passcodeOk || household === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Invalid passcode or display name.');
    }
    const member = memberByName(db, household.id, body.displayName);
    if (member === undefined) {
      throw httpError(404, 'NOT_FOUND', 'Unknown member.');
    }
    const { cookieValue } = await auth.sessions.create(household.id, member.id);
    void reply.setCookie('sid', cookieValue, auth.cookieOptions());
    return { member: toMemberDtoRow(member) };
  });

  app.post('/auth/members', async (req) => {
    const body = parseRequest(authMembersRequestSchema, req.body);
    const ip = req.ip;
    auth.loginLimiter.record(ip, auth.now());
    const decision = auth.loginLimiter.check(ip, auth.now());
    if (!decision.allowed) {
      throw httpError(429, 'RATE_LIMITED', 'Too many login attempts.', {
        retryAfterMs: decision.retryAfterMs,
      });
    }
    const household = firstHousehold(db);
    const passcodeOk =
      household !== undefined && (await verifyPasscode(body.passcode, household.passcode_hash));
    if (!passcodeOk || household === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Invalid passcode.');
    }
    return { members: activeMembers(db, household.id).map(toMemberDtoRow) };
  });

  app.post('/auth/logout', async (req, reply) => {
    auth.sessions.revoke(req.cookies.sid);
    void reply.clearCookie('sid', auth.cookieOptions());
    return {};
  });

  app.get('/auth/me', async (req) => {
    const actor = requireActor(req);
    const household = firstHousehold(db);
    const member = household === undefined ? undefined : memberById(db, household.id, actor.memberId);
    if (household === undefined || member === undefined || household.id !== actor.householdId) {
      throw httpError(401, 'UNAUTHORIZED', 'Session no longer valid.');
    }
    return { member: toMemberDtoRow(member), household: householdDto(household) };
  });

  // ── ADR-0005: household create (wizard), settings, members ──────────────

  app.post('/household', async (req, reply) => {
    if (firstHousehold(db) !== undefined) {
      throw httpError(403, 'FORBIDDEN', 'A household already exists.');
    }
    const body = parseRequest(createHouseholdRequestSchema, req.body);
    const now = auth.now();
    const passcodeHash = await hashPasscode(body.passcode);
    const created = db.transaction(() => {
      const householdId = newUuidV7(now);
      db.prepare(
        'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(householdId, body.name, passcodeHash, now);
      const memberId = newUuidV7(now);
      db.prepare(
        'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(memberId, householdId, body.displayName, body.color, now);
      appendChange(db, { entity: 'member', entityId: memberId, op: 'create' }, now);
      if (body.seedSampleData !== false) {
        // §8.9 step 4 (default on): §14.1 categories + §14.2 sample items.
        seedCategories(db, now);
        seedHouseholdCatalog(db, householdId, now);
      }
      return { householdId, memberId };
    })();
    const { cookieValue } = await auth.sessions.create(created.householdId, created.memberId);
    void reply.setCookie('sid', cookieValue, auth.cookieOptions());
    void reply.code(201);
    return {
      member: { id: created.memberId, displayName: body.displayName, color: body.color },
      household: { id: created.householdId, name: body.name },
    };
  });

  app.patch('/household', async (req) => {
    const body = parseRequest(updateHouseholdRequestSchema, req.body);
    const actor = requireActor(req);
    const household = firstHousehold(db);
    if (household === undefined || household.id !== actor.householdId) {
      throw httpError(404, 'NOT_FOUND', 'Household not found.');
    }
    if (body.name !== undefined) {
      db.prepare('UPDATE households SET name = ? WHERE id = ?').run(body.name, household.id);
    }
    if (body.passcode !== undefined) {
      const passcodeHash = await hashPasscode(body.passcode);
      db.prepare('UPDATE households SET passcode_hash = ? WHERE id = ?').run(
        passcodeHash,
        household.id,
      );
    }
    const updated = firstHousehold(db);
    if (updated === undefined) {
      throw httpError(404, 'NOT_FOUND', 'Household not found.');
    }
    return { household: householdDto(updated) };
  });

  app.post('/members', async (req, reply) => {
    const body = parseRequest(createMemberRequestSchema, req.body);
    const actor = requireActor(req);
    requireUniqueName(db, actor.householdId, body.displayName);
    const now = auth.now();
    const memberId = newUuidV7(now);
    db.prepare(
      'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(memberId, actor.householdId, body.displayName, body.color, now);
    appendChange(
      db,
      { entity: 'member', entityId: memberId, op: 'create', actorId: actor.memberId },
      now,
    );
    void reply.code(201);
    return { member: { id: memberId, displayName: body.displayName, color: body.color } };
  });

  app.patch('/members/:id', async (req) => {
    const { id } = parseRequest(idParamSchema, req.params);
    const body = parseRequest(updateMemberRequestSchema, req.body);
    const actor = requireActor(req);
    const member = memberById(db, actor.householdId, id);
    if (member === undefined) {
      throw httpError(404, 'NOT_FOUND', 'Member not found.');
    }
    if (body.displayName !== undefined) {
      requireUniqueName(db, actor.householdId, body.displayName, id);
    }
    db.prepare('UPDATE members SET display_name = ?, color = ? WHERE id = ?').run(
      body.displayName ?? member.display_name,
      body.color ?? member.color,
      id,
    );
    appendChange(
      db,
      { entity: 'member', entityId: id, op: 'update', actorId: actor.memberId },
      auth.now(),
    );
    const updated = memberById(db, actor.householdId, id);
    if (updated === undefined) {
      throw httpError(404, 'NOT_FOUND', 'Member not found.');
    }
    return { member: toMemberDtoRow(updated) };
  });

  app.delete('/members/:id', async (req) => {
    const { id } = parseRequest(idParamSchema, req.params);
    const actor = requireActor(req);
    const member = memberById(db, actor.householdId, id);
    if (member === undefined) {
      throw httpError(404, 'NOT_FOUND', 'Member not found.');
    }
    const active = activeMembers(db, actor.householdId);
    if (active.length <= 1) {
      throw httpError(403, 'FORBIDDEN', 'The last member cannot be removed.');
    }
    db.prepare('UPDATE members SET deleted_at = ? WHERE id = ?').run(auth.now(), id);
    auth.sessions.revokeAllForMember(id);
    appendChange(
      db,
      { entity: 'member', entityId: id, op: 'delete', actorId: actor.memberId },
      auth.now(),
    );
    return { deleted: true };
  });
}
