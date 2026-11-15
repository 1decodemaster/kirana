import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { newUuidV7 } from '@kirana/shared';

export interface ActorContext {
  readonly householdId: string;
  readonly memberId: string;
}

interface HouseholdRow {
  readonly id: string;
}

interface MemberRow {
  readonly id: string;
}

/**
 * Pre-auth actor resolution (P1): the board is single-household and the first
 * household + its oldest member act on every request. Replaced by session
 * auth in P4 (§7.6); the demo seed creates richer members until then.
 */
export function resolveActor(db: Database.Database, now: number): ActorContext {
  const household = db
    .prepare('SELECT id FROM households ORDER BY created_at, id LIMIT 1')
    .get() as HouseholdRow | undefined;
  if (household === undefined) {
    return createDefaultHousehold(db, now);
  }
  const member = db
    .prepare(
      'SELECT id FROM members WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1',
    )
    .get(household.id) as MemberRow | undefined;
  if (member === undefined) {
    return { householdId: household.id, memberId: createDefaultMember(db, household.id, now) };
  }
  return { householdId: household.id, memberId: member.id };
}

function createDefaultHousehold(db: Database.Database, now: number): ActorContext {
  // The passcode is unusable pre-auth: the secret is discarded after hashing.
  const secret = randomBytes(32).toString('hex');
  const householdId = newUuidV7(now);
  db.prepare(
    'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(householdId, 'Home', secret, now);
  const memberId = createDefaultMember(db, householdId, now);
  return { householdId, memberId };
}

function createDefaultMember(db: Database.Database, householdId: string, now: number): string {
  const memberId = newUuidV7(now + 1);
  db.prepare(
    'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(memberId, householdId, 'You', '#4F46E5', now);
  return memberId;
}
