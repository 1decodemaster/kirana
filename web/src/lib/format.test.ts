import { describe, expect, it } from 'vitest';
import { formatDay } from './format.js';

describe('formatDay', () => {
  it('formats an epoch-ms timestamp as its UTC day', () => {
    expect(formatDay(0)).toBe('1970-01-01');
    expect(formatDay(1731628800000)).toBe('2024-11-15');
  });
});
