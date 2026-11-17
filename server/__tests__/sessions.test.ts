import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSCODE, hashPasscode, openDatabase } from '@kirana/db';
import { loadMigrations, migrate } from '@kirana/db';
import { newUuidV7 } from '@kirana/shared';
import { SessionStore } from '../services/sessions.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));
const BASE = 1_730_000_000_000;

interface Fixture {
  db: ReturnType<typeof openDatabase>;
  householdId: string;
  memberId: string;
  otherMemberId: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = openDatabase(':memory:');
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  const householdId = newUuidV7(BASE);
  db.prepare(
    'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(householdId, 'Home', await hashPasscode(DEMO_PASSCODE), BASE);
  const memberId = newUuidV7(BASE + 1);
  db.prepare(
    'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(memberId, householdId, 'Alex', '#4F46E5', BASE + 1);
  const otherMemberId = newUuidV7(BASE + 2);
  db.prepare(
    'INSERT INTO members (id, household_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(otherMemberId, householdId, 'Sam', '#059669', BASE + 2);
  fixture = { db, householdId, memberId, otherMemberId };
});

function makeStore(now = () => BASE): SessionStore {
  return new SessionStore(fixture.db, 'test-secret', now);
}

describe('SessionStore (ADR-0006, PRD §7.6)', () => {
  it('create → resolve round-trips the actor', async () => {
    const store = makeStore();
    const { cookieValue } = await store.create(fixture.householdId, fixture.memberId);
    expect(store.resolve(cookieValue)).toEqual({
      householdId: fixture.householdId,
      memberId: fixture.memberId,
    });
  });

  it('the cookie is signed; tampering or the wrong secret fails closed', async () => {
    const store = makeStore();
    const { cookieValue } = await store.create(fixture.householdId, fixture.memberId);
    const tampered = `${cookieValue.slice(0, -2)}xx`;
    expect(store.resolve(tampered)).toBeUndefined();
    const other = new SessionStore(fixture.db, 'other-secret');
    expect(other.resolve(cookieValue)).toBeUndefined();
  });

  it('revocation invalidates the session, including the cache path', async () => {
    const store = makeStore();
    const { cookieValue } = await store.create(fixture.householdId, fixture.memberId);
    expect(store.resolve(cookieValue)).toBeDefined(); // warms the cache
    store.revoke(cookieValue);
    expect(store.resolve(cookieValue)).toBeUndefined();
  });

  it('expired sessions stop resolving', async () => {
    let now = BASE;
    const store = makeStore(() => now);
    const { cookieValue } = await store.create(fixture.householdId, fixture.memberId);
    now = BASE + 2_592_000_000; // exactly the TTL
    expect(store.resolve(cookieValue)).toBeUndefined();
  });

  it('a soft-deleted member session is inert once their sessions are revoked', async () => {
    const store = makeStore();
    const { cookieValue } = await store.create(fixture.householdId, fixture.memberId);
    expect(store.resolve(cookieValue)).toBeDefined(); // warms the cache
    // What DELETE /members/:id does (route calls revokeAllForMember).
    fixture.db.prepare('UPDATE members SET deleted_at = ? WHERE id = ?').run(BASE + 10, fixture.memberId);
    store.revokeAllForMember(fixture.memberId);
    expect(store.resolve(cookieValue)).toBeUndefined();
  });

  it('a fresh store instance (restart) resolves from the table — G4.6', async () => {
    const first = makeStore();
    const { cookieValue } = await first.create(fixture.householdId, fixture.memberId);
    const restarted = new SessionStore(fixture.db, 'test-secret', () => BASE + 1000);
    expect(restarted.resolve(cookieValue)).toEqual({
      householdId: fixture.householdId,
      memberId: fixture.memberId,
    });
  });

  it('resolve rejects cookie values without a signature part', () => {
    const store = makeStore();
    expect(store.resolve('garbage')).toBeUndefined();
    expect(store.resolve('tok.')).toBeUndefined();
    expect(store.resolve(undefined)).toBeUndefined();
  });
});
