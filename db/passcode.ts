import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** §12.2: scrypt(N=16384, r=8, p=1, keylen=64), 16-byte random salt,
 * stored as `scrypt$N$r$p$saltB64$hashB64`. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await scrypt(passcode, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? '', 'base64');
    expected = Buffer.from(hashB64 ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length !== SALT_LEN || expected.length !== KEYLEN) return false;
  const actual = await scrypt(passcode, salt, KEYLEN, { N: n, r: r, p: p });
  return timingSafeEqual(actual, expected);
}

/** Session tokens are stored only as a digest (ADR-0006). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Replace the (single) household's passcode. Recovery path for databases
 *  created before P4, whose passcode_hash is a discarded secret — no
 *  passcode can ever match it (ADR-0006). Throws when no household exists;
 *  the household's data is untouched. */
export async function setHouseholdPasscode(db: Database.Database, passcode: string): Promise<{ id: string; name: string }> {
  const household = db
    .prepare('SELECT id, name FROM households ORDER BY created_at, id LIMIT 1')
    .get() as { id: string; name: string } | undefined;
  if (household === undefined) {
    throw new Error('no household exists — create one with the first-run wizard instead');
  }
  const passcodeHash = await hashPasscode(passcode);
  db.prepare('UPDATE households SET passcode_hash = ? WHERE id = ?').run(passcodeHash, household.id);
  return { id: household.id, name: household.name };
}
