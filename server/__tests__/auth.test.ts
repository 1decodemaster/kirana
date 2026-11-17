import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSCODE } from '@kirana/db';
import { buildTestApp, injectJson, MUTATION_HEADERS } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

function parseBody(res: { payload: string }): unknown {
  return JSON.parse(res.payload) as unknown;
}

async function login(
  passcode: string,
  displayName: string,
): Promise<{ status: number; setCookie: string[] }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { passcode, displayName },
    headers: MUTATION_HEADERS,
  });
  return { status: res.statusCode, setCookie: res.cookies.map((c) => `${c.name}=${c.value}`) };
}

describe('auth enforcement (§7.6, G4.7 auth.spec server half)', () => {
  it('rejects unauthenticated API calls with 401 UNAUTHORIZED', async () => {
    const res = await injectJson(app, 'GET', '/api/v1/board', { auth: false });
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('login sets the signed HttpOnly sid cookie (§7.6)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { passcode: DEMO_PASSCODE, displayName: 'Alex' },
      headers: MUTATION_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const raw = res.headers['set-cookie'];
    expect(Array.isArray(raw) ? raw.join(';') : raw).toContain('sid=');
    const header = Array.isArray(raw) ? raw.join(';') : (raw ?? '');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('login with a wrong passcode is 401 and does not set a cookie', async () => {
    const { status, setCookie } = await login('9999', 'Alex');
    expect(status).toBe(401);
    expect(setCookie).toHaveLength(0);
  });

  it('login with a wrong passcode returns the §7.1 envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { passcode: '9999', displayName: 'Alex' },
      headers: MUTATION_HEADERS,
    });
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toMatchObject({ error: { code: 'UNAUTHORIZED', requestId: expect.any(String) } });
  });

  it('a valid passcode with an unknown member is 404 (no self-registration, §7.6)', async () => {
    const { status } = await login(DEMO_PASSCODE, 'Zed');
    expect(status).toBe(404);
  });

  it('login validation failures are 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { passcode: '12', displayName: '' },
      headers: MUTATION_HEADERS,
    });
    expect(res.statusCode).toBe(400);
    expect(parseBody(res)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('the full round-trip: login → me → board as the session member', async () => {
    const { setCookie } = await login(DEMO_PASSCODE, 'Alex');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: setCookie[0] ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(parseBody(me)).toMatchObject({
      member: { displayName: 'Alex' },
      household: { name: 'Home' },
    });
    const board = await app.inject({
      method: 'GET',
      url: '/api/v1/board',
      headers: { cookie: setCookie[0] ?? '' },
    });
    expect(board.statusCode).toBe(200);
    expect(parseBody(board)).toMatchObject({ me: { displayName: 'Alex' } });
  });

  it('logout revokes the session (replay → 401)', async () => {
    const { setCookie } = await login(DEMO_PASSCODE, 'Alex');
    const cookie = { cookie: setCookie[0] ?? '' };
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { ...MUTATION_HEADERS, ...cookie },
    });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/board', headers: cookie });
    expect(after.statusCode).toBe(401);
  });

  it('login rate limit: the sixth attempt in five minutes is 429 RATE_LIMITED (§11)', async () => {
    for (let i = 0; i < 5; i++) {
      const { status } = await login('9999', 'Alex');
      expect(status).toBe(401);
    }
    const sixth = await login('9999', 'Alex');
    expect(sixth.status).toBe(429);
    expect(parseBody(await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { passcode: '9999', displayName: 'Alex' },
      headers: MUTATION_HEADERS,
    }))).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});

describe('auth roster (ADR-0005: POST /auth/members)', () => {
  it('returns the active member list for the right passcode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/members',
      payload: { passcode: DEMO_PASSCODE },
      headers: MUTATION_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { members: Array<{ displayName: string }> };
    expect(body.members.map((m) => m.displayName)).toEqual(['Alex', 'Sam']);
  });

  it('rejects a wrong passcode with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/members',
      payload: { passcode: '9999' },
      headers: MUTATION_HEADERS,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('household creation (ADR-0005, §8.9 wizard commit)', () => {
  it('creates the household + first member on a fresh db and logs in', async () => {
    const fresh = await buildTestApp({}, { seedHousehold: false });
    try {
      const res = await fresh.inject({
        method: 'POST',
        url: '/api/v1/household',
        payload: {
          name: 'Sharma Home',
          passcode: '4321',
          displayName: 'Priya',
          color: '#16A34A',
        },
        headers: MUTATION_HEADERS,
      });
      expect(res.statusCode).toBe(201);
      const body = parseBody(res) as { member: { displayName: string }; household: { name: string } };
      expect(body).toMatchObject({ member: { displayName: 'Priya' }, household: { name: 'Sharma Home' } });
      const sid = res.cookies.find((c) => c.name === 'sid');
      expect(sid).toBeDefined();
      const me = await fresh.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `sid=${sid?.value ?? ''}` },
      });
      expect(me.statusCode).toBe(200);
      // §8.9 step 4 default on: §14.1 categories + §14.2 sample items.
      const cats = parseBody(await fresh.inject({
        method: 'GET',
        url: '/api/v1/categories',
        headers: { cookie: `sid=${sid?.value ?? ''}` },
      })) as { categories: unknown[] };
      expect(cats.categories.length).toBeGreaterThan(0);
    } finally {
      await fresh.close();
    }
  });

  it('seedSampleData: false skips the sample catalog', async () => {
    const fresh = await buildTestApp({}, { seedHousehold: false });
    try {
      const res = await fresh.inject({
        method: 'POST',
        url: '/api/v1/household',
        payload: {
          name: 'Minimal',
          passcode: '4321',
          displayName: 'Priya',
          color: '#16A34A',
          seedSampleData: false,
        },
        headers: MUTATION_HEADERS,
      });
      expect(res.statusCode).toBe(201);
      const sid = res.cookies.find((c) => c.name === 'sid');
      const cats = parseBody(await fresh.inject({
        method: 'GET',
        url: '/api/v1/categories',
        headers: { cookie: `sid=${sid?.value ?? ''}` },
      })) as { categories: unknown[] };
      expect(cats.categories).toHaveLength(0);
    } finally {
      await fresh.close();
    }
  });

  it('a second household is refused with 403 FORBIDDEN (single-tenant, §11)', async () => {
    const res = await injectJson(app, 'POST', '/api/v1/household', {
      payload: { name: 'Other', passcode: '4321', displayName: 'X', color: '#000000' },
      auth: false,
    });
    expect(res.statusCode).toBe(403);
    expect(parseBody(res)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});

describe('household settings (ADR-0005: PATCH /household)', () => {
  it('renames the household', async () => {
    const res = await injectJson(app, 'PATCH', '/api/v1/household', { payload: { name: 'New Name' } });
    expect(res.statusCode).toBe(200);
    expect(parseBody(res)).toMatchObject({ household: { name: 'New Name' } });
  });

  it('changes the passcode — old stops working, new logs in', async () => {
    const res = await injectJson(app, 'PATCH', '/api/v1/household', { payload: { passcode: '9876' } });
    expect(res.statusCode).toBe(200);
    const oldLogin = await login(DEMO_PASSCODE, 'Alex');
    expect(oldLogin.status).toBe(401);
    const newLogin = await login('9876', 'Alex');
    expect(newLogin.status).toBe(200);
  });
});

describe('member management (ADR-0005)', () => {
  it('adds a member; duplicate names are 400', async () => {
    const ok = await injectJson(app, 'POST', '/api/v1/members', {
      payload: { displayName: 'Priya', color: '#16A34A' },
    });
    expect(ok.statusCode).toBe(201);
    expect(parseBody(ok)).toMatchObject({ member: { displayName: 'Priya' } });
    const dup = await injectJson(app, 'POST', '/api/v1/members', {
      payload: { displayName: 'Priya', color: '#DC2626' },
    });
    expect(dup.statusCode).toBe(400);
    expect(parseBody(dup)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('renames a member and changes color; board reflects it', async () => {
    const created = parseBody(
      await injectJson(app, 'POST', '/api/v1/members', {
        payload: { displayName: 'Priya', color: '#16A34A' },
      }),
    ) as { member: { id: string } };
    const res = await injectJson(app, 'PATCH', `/api/v1/members/${created.member.id}`, {
      payload: { displayName: 'P.', color: '#DC2626' },
    });
    expect(res.statusCode).toBe(200);
    expect(parseBody(res)).toMatchObject({ member: { displayName: 'P.', color: '#DC2626' } });
    const board = parseBody(await injectJson(app, 'GET', '/api/v1/board')) as {
      members: Array<{ displayName: string }>;
    };
    expect(board.members.map((m) => m.displayName)).toContain('P.');
  });

  it('deleting a member is soft — rows keep checked_by, roster loses them', async () => {
    const created = parseBody(
      await injectJson(app, 'POST', '/api/v1/members', {
        payload: { displayName: 'Priya', color: '#16A34A' },
      }),
    ) as { member: { id: string } };
    const del = await injectJson(app, 'DELETE', `/api/v1/members/${created.member.id}`);
    expect(del.statusCode).toBe(200);
    expect(parseBody(del)).toEqual({ deleted: true });
    const row = app.db
      .prepare('SELECT deleted_at FROM members WHERE id = ?')
      .get(created.member.id) as { deleted_at: number | null };
    expect(row.deleted_at).not.toBeNull();
    const roster = parseBody(await app.inject({
      method: 'POST',
      url: '/api/v1/auth/members',
      payload: { passcode: DEMO_PASSCODE },
      headers: MUTATION_HEADERS,
    })) as { members: Array<{ displayName: string }> };
    expect(roster.members.map((m) => m.displayName)).not.toContain('Priya');
  });

  it('refuses to delete the last active member with 403', async () => {
    const me = parseBody(await injectJson(app, 'GET', '/api/v1/auth/me')) as {
      member: { id: string };
    };
    // Two demo members exist (Alex, Sam): deleting Sam is fine, deleting
    // Alex afterwards would leave zero — 403.
    const sam = parseBody(await app.inject({
      method: 'POST',
      url: '/api/v1/auth/members',
      payload: { passcode: DEMO_PASSCODE },
      headers: MUTATION_HEADERS,
    })) as { members: Array<{ id: string; displayName: string }> };
    const samId = sam.members.find((m) => m.displayName === 'Sam')?.id;
    expect(samId).toBeDefined();
    const delSam = await injectJson(app, 'DELETE', `/api/v1/members/${samId}`);
    expect(delSam.statusCode).toBe(200);
    const delLast = await injectJson(app, 'DELETE', `/api/v1/members/${me.member.id}`);
    expect(delLast.statusCode).toBe(403);
    expect(parseBody(delLast)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('unknown member id is 404', async () => {
    const res = await injectJson(app, 'PATCH', '/api/v1/members/01913b5e-7d5a-7000-8000-0000000000ff', {
      payload: { displayName: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('mutation rate limit (§11: 120/min/session)', () => {
  it('blocks the 121st mutation with 429 RATE_LIMITED', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 121; i++) {
      const res = await injectJson(app, 'PATCH', '/api/v1/list-items/01913b5e-7d5a-7000-8000-0000000000ff', {
        payload: { note: `spam ${i}` },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
