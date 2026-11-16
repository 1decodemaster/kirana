import { describe, expect, it } from 'vitest';
import { CsvParseError, parseCsv, stringifyCsv } from '../services/csv.js';

describe('parseCsv (§9.1)', () => {
  it('parses plain rows and keeps physical line numbers (header = 1)', () => {
    const { rows, lineNumbers } = parseCsv('store,name\nCostco,Tomatoes\nIndian Store,Dal\n');
    expect(rows).toEqual([
      ['store', 'name'],
      ['Costco', 'Tomatoes'],
      ['Indian Store', 'Dal'],
    ]);
    expect(lineNumbers).toEqual([1, 2, 3]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    const { rows, lineNumbers } = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(lineNumbers).toEqual([1, 2, 3]);
  });

  it('strips a UTF-8 BOM', () => {
    const { rows } = parseCsv('\uFEFFstore,name\nCostco,Tomatoes');
    expect(rows[0]).toEqual(['store', 'name']);
  });

  it('supports quoted fields with commas, doubled quotes and newlines', () => {
    const { rows } = parseCsv('note\n"has, comma"\n"say ""hi"""\n"line one\nline two"');
    expect(rows).toEqual([['note'], ['has, comma'], ['say "hi"'], ['line one\nline two']]);
  });

  it('keeps empty fields and trailing separators', () => {
    const { rows } = parseCsv('a,b,c\n,,\nx,');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
      ['x', ''],
    ]);
  });

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvParseError);
  });
});

describe('stringifyCsv (§9.1)', () => {
  it('quotes only fields that need it and doubles embedded quotes', () => {
    expect(
      stringifyCsv([
        ['store', 'name', 'note'],
        ['Costco', 'Tomatoes', 'plain'],
        ['Indian Store', 'Dal "chana"', 'a,b\nc'],
      ]),
    ).toBe('store,name,note\r\nCostco,Tomatoes,plain\r\nIndian Store,"Dal ""chana""","a,b\nc"\r\n');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['store', 'category', 'name', 'aliases', 'qty', 'unit', 'note'],
      ['Indian Store', 'Grains & Lentils', 'Basmati Rice', 'chawal|चावल', '5', 'kg', 'line1\nline2'],
    ];
    expect(parseCsv(stringifyCsv(rows)).rows).toEqual(rows);
  });
});
