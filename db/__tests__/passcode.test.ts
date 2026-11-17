import { describe, expect, it } from 'vitest';
import { hashPasscode, verifyPasscode, sha256Hex } from '../passcode.js';

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
