import { describe, expect, it } from 'vitest';
import { normalizeName } from './normalize.js';

describe('normalizeName (PRD §6.1)', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeName('Café')).toBe('cafe');
    expect(normalizeName('Crème Fraîche')).toBe('creme fraiche');
  });

  it('maps curly quotes and dashes to ASCII', () => {
    expect(normalizeName('Ghee\u2019s')).toBe("ghee's");
    expect(normalizeName('Co-op \u2013 fresh')).toBe('co-op - fresh');
    expect(normalizeName('chilli\u2014extra')).toBe('chilli-extra');
  });

  it('strips punctuation that is not a letter, number, space, apostrophe or hyphen', () => {
    expect(normalizeName('Rice (Basmati), 5kg!')).toBe('rice basmati 5kg');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeName('  Basmati   Rice  ')).toBe('basmati rice');
  });

  it('keeps Devanagari norms consistent (matras collapse deterministically — §6.1 verbatim)', () => {
    expect(normalizeName('प्याज़')).toBe(normalizeName('प्याज'));
    expect(normalizeName('चावल')).toBe(normalizeName('चावल'));
    expect(normalizeName('चावल')).not.toBe('');
  });

  it('is used for uniqueness, never display (§6.1)', () => {
    expect(normalizeName('Basmati Rice')).not.toBe('Basmati Rice');
    expect(normalizeName('BASMATI rice')).toBe(normalizeName('basmati RICE'));
  });
});
