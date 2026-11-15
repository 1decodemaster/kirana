import { describe, expect, it } from 'vitest';
import { newUuidV7 } from './ids.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newUuidV7 (PRD §7.1 — all IDs are UUIDv7)', () => {
  it('produces a valid UUIDv7 string', () => {
    const id = newUuidV7();
    expect(id).toMatch(UUID_V7);
  });

  it('encodes the injected timestamp in the first 48 bits', () => {
    const now = 1730000000000;
    const id = newUuidV7(now);
    const hex = id.replace(/-/g, '');
    const ts = Number.parseInt(hex.slice(0, 12), 16);
    expect(ts).toBe(now);
  });

  it('uses the version and variant bits', () => {
    const id = newUuidV7(1700000000000);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is injectable for deterministic tests (AGENTS.md §6.2)', () => {
    const a = newUuidV7(1730000000000);
    const b = newUuidV7(1730000000000);
    expect(a).not.toBe(b);
    expect(a.slice(0, 12)).toBe(b.slice(0, 12));
  });
});
