import { describe, expect, it } from 'vitest';
import { fold } from './fold.js';

describe('fold — Hinglish spelling variants map to one key (PRD §2)', () => {
  it('collapses long-vowel spellings', () => {
    expect(fold('chawal')).toBe(fold('chaawal'));
    expect(fold('chawal')).toBe(fold('chawaal'));
    expect(fold('dal')).toBe(fold('daal'));
    expect(fold('atta')).toBe(fold('aata'));
  });

  it('collapses z/j spellings', () => {
    expect(fold('pyaz')).toBe(fold('pyaaz'));
    expect(fold('pyaz')).toBe(fold('pyaaj'));
    expect(fold('pyaj')).toBe(fold('pyaaz'));
  });

  it('collapses u/oo and i/ee spellings', () => {
    expect(fold('doodh')).toBe(fold('dudh'));
    expect(fold('doodh')).toBe(fold('dud'));
    expect(fold('paneer')).toBe(fold('panir'));
    expect(fold('jeera')).toBe(fold('jira'));
    expect(fold('ghee')).toBe(fold('ghi'));
  });

  it('drops aspirated consonants', () => {
    expect(fold('doodh')).toBe(fold('dudh'));
    expect(fold('khana')).toBe(fold('kana'));
    expect(fold('adhrak')).toBe(fold('adrak'));
    expect(fold('phul')).toBe(fold('ful'));
  });

  it('is idempotent and normalizing', () => {
    expect(fold(fold('Chaawal'))).toBe(fold('chaawal'));
    expect(fold('  Pyaaz! ')).toBe(fold('pyaz'));
  });

  it('keeps distinct words distinct', () => {
    expect(fold('milk')).not.toBe(fold('doodh'));
    expect(fold('salt')).not.toBe(fold('namak'));
  });
});
