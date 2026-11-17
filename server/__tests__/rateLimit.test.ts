import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../services/rateLimit.js';

const WINDOW = 5 * 60 * 1000;

describe('createRateLimiter — request-counting mode (mutations, §11)', () => {
  it('allows up to the limit, then blocks until the window drains', () => {
    const limiter = createRateLimiter(3, WINDOW);
    for (const t of [1000, 2000, 3000]) {
      limiter.record('s1', t);
      expect(limiter.check('s1', t).allowed).toBe(true);
    }
    limiter.record('s1', 4000);
    const blocked = limiter.check('s1', 4000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(WINDOW - 3000);
  });

  it('frees the key once all attempts age out of the window', () => {
    const limiter = createRateLimiter(2, WINDOW);
    limiter.record('s1', 1000);
    limiter.record('s1', 2000);
    limiter.record('s1', 3000);
    expect(limiter.check('s1', 3000).allowed).toBe(false);
    expect(limiter.check('s1', 1000 + WINDOW + 1).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter(1, WINDOW);
    limiter.record('a', 1000);
    limiter.record('a', 1001);
    expect(limiter.check('b', 1000).allowed).toBe(true);
    expect(limiter.check('a', 1001).allowed).toBe(false);
  });
});

describe('createRateLimiter — login mode (§7.6 "then exponential backoff")', () => {
  const login = createRateLimiterFactory();

  function createRateLimiterFactory() {
    return () => createRateLimiter(5, WINDOW, { escalate: true });
  }

  it('allows five attempts in the window and blocks the sixth', () => {
    const limiter = login();
    for (let i = 0; i < 5; i++) {
      const t = 1000 + i;
      limiter.record('ip', t);
      expect(limiter.check('ip', t).allowed).toBe(true);
    }
    const t6 = 1005;
    limiter.record('ip', t6);
    const decision = limiter.check('ip', t6);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(WINDOW);
  });

  it('doubles the block when a client keeps hammering past the expiry', () => {
    const limiter = login();
    for (let i = 0; i < 5; i++) {
      const t = 1000 + i;
      limiter.record('ip', t);
      limiter.check('ip', t);
    }
    // Sixth attempt breaches: blocked for the full window.
    limiter.record('ip', 1500);
    expect(limiter.check('ip', 1500).retryAfterMs).toBe(WINDOW);
    // Hammering every 100 ms while blocked never escalates mid-block…
    for (let t = 1600; t < 1500 + WINDOW; t += 100) {
      limiter.record('ip', t);
      expect(limiter.check('ip', t).allowed).toBe(false);
    }
    // …but the first attempt after the block expires, still over the
    // limit, doubles the block.
    const t = 1500 + WINDOW + 100;
    limiter.record('ip', t);
    const decision = limiter.check('ip', t);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(WINDOW * 2);
  });

  it('caps the escalated block at maxBlockMs', () => {
    const limiter = createRateLimiter(2, WINDOW, { escalate: true, maxBlockMs: WINDOW * 3 });
    const hammer = (t: number) => {
      limiter.record('ip', t);
      return limiter.check('ip', t);
    };
    const blocks: number[] = [];
    for (let t = 1000; t < 1000 + WINDOW * 12; t += 100) {
      const decision = hammer(t);
      if (!decision.allowed) blocks.push(decision.retryAfterMs ?? -1);
    }
    expect(blocks).toContain(WINDOW);
    expect(blocks).toContain(WINDOW * 2);
    expect(Math.max(...blocks)).toBe(WINDOW * 3);
  });

  it('resets escalation once attempts age out and the block expires', () => {
    const limiter = login();
    for (let i = 0; i < 6; i++) limiter.record('ip', 1000 + i);
    expect(limiter.check('ip', 1010).allowed).toBe(false);
    // Quiet period longer than block + window.
    const after = 1000 + WINDOW * 3 + 1;
    expect(limiter.check('ip', after).allowed).toBe(true);
    for (let i = 0; i < 5; i++) limiter.record('ip', after + i);
    expect(limiter.check('ip', after + 10).allowed).toBe(true);
    limiter.record('ip', after + 11);
    expect(limiter.check('ip', after + 11).retryAfterMs).toBe(WINDOW);
  });
});
