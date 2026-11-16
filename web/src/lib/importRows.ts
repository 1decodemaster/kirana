import type { ImportDecision, ImportRowDto } from '@kirana/shared';

/** Which action a row will take at commit time (§9.3: undecided lines keep
 *  their preview action; error rows cannot be decided at all). */
export type RowDecision = 'create' | 'merge' | 'skip';

/** line → decision for every row the user can act on. */
export type DecisionMap = ReadonlyMap<number, RowDecision>;

export function initialDecisions(rows: readonly ImportRowDto[]): DecisionMap {
  const map = new Map<number, RowDecision>();
  for (const row of rows) {
    if (row.action === 'error') continue;
    map.set(row.line, row.action);
  }
  return map;
}

export function withDecision(
  decisions: DecisionMap,
  line: number,
  decision: RowDecision,
): DecisionMap {
  const next = new Map(decisions);
  next.set(line, decision);
  return next;
}

/** Rows that will be written when the user commits. */
export function committedRows(
  rows: readonly ImportRowDto[],
  decisions: DecisionMap,
): readonly ImportRowDto[] {
  return rows.filter((row) => {
    const decision = decisions.get(row.line);
    return row.action !== 'error' && decision !== undefined && decision !== 'skip';
  });
}

export function countToImport(
  rows: readonly ImportRowDto[],
  decisions: DecisionMap,
): number {
  return committedRows(rows, decisions).length;
}

/** The commit request body's decisions (§7.2 #29): one per non-error line;
 *  merge carries the preview's suggested target. A merge whose row somehow
 *  has no target downgrades to skip — the server rejects a target-less
 *  merge with 400 and that would fail the whole commit. */
export function decisionsForCommit(
  rows: readonly ImportRowDto[],
  decisions: DecisionMap,
): ImportDecision[] {
  const result: ImportDecision[] = [];
  for (const row of rows) {
    const decision = decisions.get(row.line);
    if (row.action === 'error' || decision === undefined) continue;
    if (decision === 'merge' && row.targetItemId !== null) {
      result.push({ line: row.line, action: 'merge', targetItemId: row.targetItemId });
    } else {
      result.push({ line: row.line, action: decision === 'merge' ? 'skip' : decision });
    }
  }
  return result;
}

/** Distinct store names among the rows that will be written — the {m} in
 *  the §8.10 success copy. */
export function distinctStores(
  rows: readonly ImportRowDto[],
  decisions: DecisionMap,
): number {
  return new Set(committedRows(rows, decisions).map((row) => row.store)).size;
}
