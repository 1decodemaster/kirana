import { describe, expect, it } from 'vitest';
import { hashPasscode, setHouseholdPasscode, sha256Hex, verifyPasscode } from '../passcode.js';
import { openDatabase } from '../connection.js';
import { loadMigrations, migrate } from '../migrate.js';
import { fileURLToPath } from 'node:url';
import { newUuidV7 } from '@kirana/shared';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

describe('passcode hashing (PRD §12.2)', () => {
  it('produces the scrypt$N$r$p$salt$hash format', async () => {
    const hash = await hashPasscode('1234');
    const parts = hash.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toBe('16384');
    expect(parts[2]).toBe('8');
    expect(parts[3]).toBe('1');
  });

  it('round-trips the correct passcode', async () => {
    const hash = await hashPasscode('correct horse battery');
    await expect(verifyPasscode('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong passcode', async () => {
    const hash = await hashPasscode('1234');
    await expect(verifyPasscode('4321', hash)).resolves.toBe(false);
  });

  it('salts uniquely — two hashes of the same passcode differ', async () => {
    const a = await hashPasscode('1234');
    const b = await hashPasscode('1234');
    expect(a).not.toBe(b);
    await expect(verifyPasscode('1234', a)).resolves.toBe(true);
    await expect(verifyPasscode('1234', b)).resolves.toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    await expect(verifyPasscode('1234', '')).resolves.toBe(false);
    await expect(verifyPasscode('1234', 'plaintext')).resolves.toBe(false);
    await expect(verifyPasscode('1234', 'scrypt$x$y$z$salt$hash')).resolves.toBe(false);
    await expect(verifyPasscode('1234', 'scrypt$16384$8$1$bad-base64!$hash')).resolves.toBe(false);
  });

  it('sha256Hex is a stable hex digest of the utf8 value', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('setHouseholdPasscode (pre-P4 recovery, ADR-0006)', () => {
  it('replaces the passcode so the household becomes loggable again', async () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db, loadMigrations(MIGRATIONS_DIR));
      // A pre-P4 household: the "hash" is a discarded secret, never scrypt.
      db.prepare(
        'INSERT INTO households (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(newUuidV7(1), 'Home', 'be2deb20a9670efe7d65e171c437733abf358f328d83aa463600798ef7275223', 1);
      await expect(verifyPasscode('1234', 'be2deb20a9670efe7d65e171c437733abf358f328d83aa463600798ef7275223')).resolves.toBe(false);

      const household = await setHouseholdPasscode(db, '1234');
      expect(household.name).toBe('Home');

      const row = db.prepare('SELECT passcode_hash FROM households').get() as {
        passcode_hash: string;
      };
      await expect(verifyPasscode('1234', row.passcode_hash)).resolves.toBe(true);
      await expect(verifyPasscode('4321', row.passcode_hash)).resolves.toBe(false);
    } finally {
      db.close();
    }
  });

  it('refuses when no household exists (the wizard owns creation)', async () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db, loadMigrations(MIGRATIONS_DIR));
      await expect(setHouseholdPasscode(db, '1234')).rejects.toThrow(/no household exists/);
    } finally {
      db.close();
    }
  });
});
