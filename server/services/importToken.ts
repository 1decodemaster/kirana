import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ImportRowDto } from '@kirana/shared';
import { httpError } from '../plugins/errors.js';

/** The signed preview token (§9.3): an in-memory map keyed by an HMAC-signed
 * id with a 10-minute TTL. Single-process by design (single-tenant homelab);
 * a multi-instance deployment would need this to move to shared storage. */

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_STORED_PREVIEWS = 20;

/** What a preview holds between preview and commit: the contract DTOs plus the
 * server-only set of invalid lines (they show in the diff but are not
 * importable). Never leaves the process. */
export interface StoredPreview {
  readonly householdId: string;
  readonly rows: readonly ImportRowDto[];
  readonly invalidLines: ReadonlySet<number>;
  readonly expiresAt: number;
}

const previews = new Map<string, StoredPreview>();

export function issuePreviewToken(
  secret: string,
  householdId: string,
  preview: { rows: readonly ImportRowDto[]; invalidLines: ReadonlySet<number> },
  now: number,
): string {
  const id = randomBytes(16).toString('hex');
  previews.set(id, {
    householdId,
    rows: preview.rows,
    invalidLines: preview.invalidLines,
    expiresAt: now + PREVIEW_TTL_MS,
  });
  sweepPreviews(now);
  const sig = createHmac('sha256', secret).update(id).digest('hex');
  return `${id}.${sig}`;
}

function sweepPreviews(now: number): void {
  for (const [id, entry] of previews) {
    if (entry.expiresAt <= now) previews.delete(id);
  }
  while (previews.size > MAX_STORED_PREVIEWS) {
    const oldest = previews.keys().next();
    if (oldest.done === true) break;
    previews.delete(oldest.value);
  }
}

/** Forget a preview after its commit succeeded (a replayed commit then gets
 * the same 410 as an unknown token). */
export function discardPreview(token: string): void {
  const dot = token.indexOf('.');
  if (dot !== -1) previews.delete(token.slice(0, dot));
}

/** Verify the signature, the TTL and the household; unknown/expired/tampered
 * tokens all end the preview's life. */
export function consumePreviewToken(
  secret: string,
  householdId: string,
  token: string,
  now: number,
): StoredPreview {
  const dot = token.indexOf('.');
  const id = dot === -1 ? '' : token.slice(0, dot);
  const sig = dot === -1 ? '' : token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(id).digest('hex');
  const sigOk = sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  const entry = sigOk ? previews.get(id) : undefined;
  if (entry === undefined) {
    throw httpError(410, 'IMPORT_TOKEN_EXPIRED', 'Import preview expired or unknown — preview the file again.');
  }
  if (entry.householdId !== householdId) {
    throw httpError(403, 'FORBIDDEN', 'Import preview belongs to a different household.');
  }
  if (entry.expiresAt <= now) {
    previews.delete(id);
    throw httpError(410, 'IMPORT_TOKEN_EXPIRED', 'Import preview expired — preview the file again.');
  }
  return entry;
}
