/**
 * Sliding-window rate limiters (PRD §11): login 5/5min/IP with exponential
 * backoff; mutations 120/min/session. Time is injected — no Date.now() —
 * so the policy is unit-testable (AGENTS §5).
 *
 * Order of operations: record() the attempt FIRST, then check(). Exactly
 * `limit` attempts per window pass; the (limit+1)-th is blocked and — in
 * escalate mode — grows the block 2× per re-breach after expiry, capped at
 * maxBlockMs.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

interface Bucket {
  attempts: number[];
  blockUntil: number;
  blockCount: number;
}

const MAX_BUCKETS = 10_000;
/** Bound the per-key attempt memory against abusive clients. */
const MAX_ATTEMPTS = 200;

export interface RateLimiterOptions {
  /** Escalate the block 2× for every attempt recorded past the limit
   * (login backoff, §7.6). Default: plain sliding window. */
  readonly escalate?: boolean;
  readonly maxBlockMs?: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitDecision;
  record(key: string, now: number): void;
}

export function createRateLimiter(
  limit: number,
  windowMs: number,
  options: RateLimiterOptions = {},
): RateLimiter {
  const escalate = options.escalate === true;
  const maxBlockMs = options.maxBlockMs ?? 60 * 60 * 1000;
  const buckets = new Map<string, Bucket>();

  function bucketFor(key: string, now: number): Bucket {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      bucket = { attempts: [], blockUntil: 0, blockCount: 0 };
      buckets.set(key, bucket);
      return bucket;
    }
    bucket.attempts = bucket.attempts.filter((t) => t > now - windowMs);
    if (bucket.attempts.length === 0 && now >= bucket.blockUntil) {
      bucket.blockCount = 0;
    }
    return bucket;
  }

  function pruneAttempts(bucket: Bucket): void {
    while (bucket.attempts.length > MAX_ATTEMPTS) bucket.attempts.shift();
  }

  return {
    check(key, now) {
      const bucket = bucketFor(key, now);
      if (now < bucket.blockUntil) {
        return { allowed: false, retryAfterMs: bucket.blockUntil - now };
      }
      if (bucket.attempts.length > limit) {
        const oldest = bucket.attempts[0] ?? now;
        return { allowed: false, retryAfterMs: Math.max(windowMs - (now - oldest), 1) };
      }
      return { allowed: true };
    },
    record(key, now) {
      const bucket = bucketFor(key, now);
      bucket.attempts.push(now);
      pruneAttempts(bucket);
      if (escalate && bucket.attempts.length > limit && now >= bucket.blockUntil) {
        bucket.blockCount += 1;
        const block = Math.min(windowMs * 2 ** (bucket.blockCount - 1), maxBlockMs);
        bucket.blockUntil = now + block;
      }
    },
  };
}
