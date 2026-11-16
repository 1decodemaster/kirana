import { describe, expect, it } from 'vitest';
import type { ImportRowDto } from '@kirana/shared';
import {
  committedRows,
  countToImport,
  decisionsForCommit,
  distinctStores,
  initialDecisions,
  withDecision,
} from './importRows.js';

const row = (overrides: Partial<ImportRowDto> & { line: number }): ImportRowDto => ({
  store: 'Costco',
  category: null,
  name: `Item ${overrides.line}`,
  aliases: [],
  qty: null,
  unit: null,
  note: null,
  action: 'create',
  targetItemId: null,
  targetName: null,
  message: null,
  ...overrides,
});

const rows: readonly ImportRowDto[] = [
  row({ line: 2, name: 'Milk', action: 'create' }),
  row({ line: 3, name: 'Basmati Rice', action: 'merge', targetItemId: 'i1', targetName: 'Basmati Rice' }),
  row({ line: 4, name: 'Curd', action: 'skip' }),
  row({ line: 5, name: 'Broken', action: 'error', message: 'missing store' }),
];

describe('initialDecisions', () => {
  it('seeds every non-error row with its preview action', () => {
    const decisions = initialDecisions(rows);
    expect(decisions.get(2)).toBe('create');
    expect(decisions.get(3)).toBe('merge');
    expect(decisions.get(4)).toBe('skip');
    expect(decisions.has(5)).toBe(false);
  });
});

describe('withDecision', () => {
  it('returns a new map with the line changed', () => {
    const decisions = withDecision(initialDecisions(rows), 4, 'create');
    expect(decisions.get(4)).toBe('create');
    expect(initialDecisions(rows).get(4)).toBe('skip');
  });
});

describe('committedRows / countToImport', () => {
  it('excludes skipped and error rows', () => {
    expect(committedRows(rows, initialDecisions(rows)).map((r) => r.line)).toEqual([2, 3]);
    expect(countToImport(rows, initialDecisions(rows))).toBe(2);
  });

  it('follows user overrides', () => {
    const decisions = withDecision(initialDecisions(rows), 2, 'skip');
    expect(countToImport(rows, decisions)).toBe(1);
  });
});

describe('decisionsForCommit', () => {
  it('carries the merge target and drops error lines', () => {
    expect(decisionsForCommit(rows, initialDecisions(rows))).toEqual([
      { line: 2, action: 'create' },
      { line: 3, action: 'merge', targetItemId: 'i1' },
      { line: 4, action: 'skip' },
    ]);
  });

  it('downgrades a target-less merge to skip instead of failing the commit', () => {
    const noTarget = [row({ line: 6, action: 'merge', targetItemId: null })];
    expect(decisionsForCommit(noTarget, new Map([[6, 'merge' as const]]))).toEqual([
      { line: 6, action: 'skip' },
    ]);
  });
});

describe('distinctStores', () => {
  it('counts distinct stores among committed rows only', () => {
    const wide = [
      row({ line: 2, store: 'Costco', action: 'create' }),
      row({ line: 3, store: 'Indian Store', action: 'create' }),
      row({ line: 4, store: 'Costco', action: 'merge', targetItemId: 'i1' }),
      row({ line: 5, store: 'Target', action: 'skip' }),
    ];
    expect(distinctStores(wide, initialDecisions(wide))).toBe(2);
  });
});
