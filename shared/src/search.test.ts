import { describe, expect, it } from 'vitest';
import {
  buildSearchCandidate,
  compareMatches,
  ftsPhraseQueries,
  matchQuality,
  prepareQuery,
  resolveItem,
  searchScore,
  EMPTY_SIGNALS,
  NEAR_DUPLICATE_THRESHOLD,
  type ResolveCandidate,
  type SearchCandidate,
} from './search.js';

const DAY_MS = 86_400_000;

function mq(raw: string, candidate: SearchCandidate): ReturnType<typeof matchQuality> {
  return matchQuality(prepareQuery(raw), candidate);
}

/** Seed-shaped catalog rows (db/seed/items.json) used across the suites. */
const onion = buildSearchCandidate('Onion', ['pyaaz', 'pyaz', 'प्याज़']);
const rice = buildSearchCandidate('Basmati Rice', ['chawal', 'chaawal', 'चावल', 'rice']);
const milk = buildSearchCandidate('Milk', ['doodh', 'दूध']);
const atta = buildSearchCandidate('Atta', ['aata', 'आटा', 'flour']);
const milkPowder = buildSearchCandidate('Milk Powder', []);

describe('matchQuality — §8.6 tiers (G2.2)', () => {
  it('exact name_norm → 1.00 via name', () => {
    expect(mq('milk', milk)).toEqual({ quality: 1.0, via: 'name' });
    expect(mq('MILK', milk)).toEqual({ quality: 1.0, via: 'name' });
  });

  it('exact alias_norm → 0.95 via alias', () => {
    expect(mq('pyaz', onion)).toEqual({ quality: 0.95, via: 'alias' });
    expect(mq('pyaaz', onion)).toEqual({ quality: 0.95, via: 'alias' });
  });

  it('norm prefix on name or alias → 0.85', () => {
    expect(mq('mil', milk)).toEqual({ quality: 0.85, via: 'name' });
    expect(mq('dood', milk)).toEqual({ quality: 0.85, via: 'alias' });
    expect(mq('pya', onion)).toEqual({ quality: 0.85, via: 'alias' });
  });

  it('fold prefix catches Hinglish spellings the norm misses', () => {
    // 'pyaj' is not a prefix of 'pyaaz', but fold('pyaj') === fold('pyaaz')
    expect(mq('pyaj', onion)).toEqual({ quality: 0.85, via: 'alias' });
    // 'dud' folds from 'dood' — prefix of fold('doodh') === 'dud'
    expect(mq('dud', milk)).toEqual({ quality: 0.85, via: 'alias' });
    // double-letter typo folds to the exact name fold → via name
    expect(mq('miilk', milk)).toEqual({ quality: 0.85, via: 'name' });
  });

  it('substring (trigram tier) → 0.70, gated at 3 transformed codepoints', () => {
    expect(mq('ilk', milk)).toEqual({ quality: 0.7, via: 'name' });
    expect(mq('awa', rice)).toEqual({ quality: 0.7, via: 'alias' });
    // 2-codepoint queries never reach the substring tier
    expect(mq('il', milk)).toBeNull();
  });

  it('fold substring tier fires when the norm substring does not', () => {
    // 'iilk' folds to 'ilk': no norm substring/prefix match, but fold('milk') contains it
    expect(mq('iilk', milk)).toEqual({ quality: 0.7, via: 'name' });
    // 'yaj' is inside fold('pyaaz') === 'pyaj' but not inside any norm form
    expect(mq('yaj', onion)).toEqual({ quality: 0.7, via: 'alias' });
  });

  it('a query whose fold is empty skips the fold tiers entirely', () => {
    // fold('h') strips the trailing h → ''; only norm tiers may match
    expect(mq('h', milk)).toBeNull();
  });

  it('fuzzy tier: ratio ≥ 0.7 contributes 0.5 × ratio', () => {
    // 'milkk' folds to 'milk' exactly (repeat collapse) → prefix tier, not fuzzy
    expect(mq('milkk', milk)).toEqual({ quality: 0.85, via: 'name' });
    // 'mlk' (dropped i): dist('mlk','milk') = 1, maxLen 4 → ratio 0.75 → 0.375
    expect(mq('mlk', milk)).toEqual({ quality: 0.375, via: 'fuzzy' });
    // too far: dist 2 of 4 → ratio 0.5 < 0.7
    expect(mq('mels', milk)).toBeNull();
  });

  it('fuzzy tier keeps the best ratio across name and alias folds', () => {
    // name fold 'mxlkotq' scores 1 − 2/7 ≈ 0.714; alias fold 'mlkot' scores
    // 1 − 1/6 ≈ 0.833 — the alias must win
    const odd = buildSearchCandidate('Mxxlkotq', ['mlkot']);
    const hit = mq('mlkotx', odd);
    expect(hit?.via).toBe('fuzzy');
    expect(hit?.quality).toBeCloseTo(0.5 * (1 - 1 / 6), 5);
  });

  it('junk query never substring-matches via the fold collapse footgun', () => {
    // fold('zzzz') collapses to 'j'; the transformed-length gate must prevent
    // every alias containing 'j' from matching
    expect(mq('zzzz', onion)).toBeNull();
    expect(mq('zzzz', rice)).toBeNull();
  });

  it('empty/normalized-away queries match nothing', () => {
    expect(mq('   ', milk)).toBeNull();
    expect(mq('!!!', milk)).toBeNull();
  });

  it('single letters match by prefix only (short-query behaviour)', () => {
    expect(mq('m', milk)).toEqual({ quality: 0.85, via: 'name' });
    expect(mq('m', atta)).toBeNull();
  });
});

describe('G2.4 — the six mandated queries find the right item', () => {
  const catalog = [onion, rice, milk, atta, milkPowder];

  function best(raw: string): { name: string; via: string } | null {
    const q = prepareQuery(raw);
    let top: { name: string; via: string; score: number } | null = null;
    for (const c of catalog) {
      const s = searchScore(q, c, EMPTY_SIGNALS, null, 0);
      if (s !== null && (top === null || s.score > top.score)) {
        const names: Record<string, string> = {
          [onion.nameNorm]: 'Onion',
          [rice.nameNorm]: 'Basmati Rice',
          [milk.nameNorm]: 'Milk',
          [atta.nameNorm]: 'Atta',
          [milkPowder.nameNorm]: 'Milk Powder',
        };
        top = { name: names[c.nameNorm] ?? c.nameNorm, via: s.via, score: s.score };
      }
    }
    return top;
  }

  const expected: Array<[string, string]> = [
    ['pya', 'Onion'],
    ['pyaz', 'Onion'],
    ['प्याज़', 'Onion'],
    ['chawa', 'Basmati Rice'],
    ['dood', 'Milk'],
    ['milk', 'Milk'],
  ];

  for (const [query, item] of expected) {
    it(`"${query}" → ${item}`, () => {
      const hit = best(query);
      expect(hit?.name).toBe(item);
    });
  }

  it('प्याज़ matches even without the nukta (प्याज)', () => {
    expect(mq('प्याज', onion)?.quality).toBe(0.95);
  });

  it('queries do not cross-match unrelated items', () => {
    expect(mq('dood', rice)).toBeNull();
    expect(mq('pya', milk)).toBeNull();
  });
});

describe('searchScore — §8.6 weights (G2.2)', () => {
  const now = 1_700_000_000_000;

  it('exact match with no signals scores exactly 0.55', () => {
    expect(searchScore(prepareQuery('milk'), milk, EMPTY_SIGNALS, null, now)?.score).toBeCloseTo(0.55);
  });

  it('store affinity adds 0.25 when the item was ever added to this store', () => {
    const signals = { timesAdded: 0, lastAddedAt: null, storeIds: ['s_1'] };
    expect(searchScore(prepareQuery('milk'), milk, signals, 's_1', now)?.score).toBeCloseTo(0.8);
    expect(searchScore(prepareQuery('milk'), milk, signals, 's_2', now)?.score).toBeCloseTo(0.55);
    expect(searchScore(prepareQuery('milk'), milk, signals, null, now)?.score).toBeCloseTo(0.55);
  });

  it('recency decays exp(-days/30) and never goes negative on clock skew', () => {
    const signals = { timesAdded: 0, lastAddedAt: now, storeIds: [] };
    expect(searchScore(prepareQuery('milk'), milk, signals, null, now)?.score).toBeCloseTo(0.55 + 0.15);
    expect(searchScore(prepareQuery('milk'), milk, signals, null, now + 30 * DAY_MS)?.score).toBeCloseTo(
      0.55 + 0.15 * Math.exp(-1),
      5,
    );
    // lastAddedAt in the future (skewed clock) clamps to 0 days
    expect(searchScore(prepareQuery('milk'), milk, signals, null, now - 5 * DAY_MS)?.score).toBeCloseTo(0.7);
  });

  it('frequency is min(timesAdded/20, 1)', () => {
    const half = { timesAdded: 10, lastAddedAt: null, storeIds: [] };
    const capped = { timesAdded: 100, lastAddedAt: null, storeIds: [] };
    expect(searchScore(prepareQuery('milk'), milk, half, null, now)?.score).toBeCloseTo(0.55 + 0.025);
    expect(searchScore(prepareQuery('milk'), milk, capped, null, now)?.score).toBeCloseTo(0.6);
  });

  it('the maximum possible score is exactly 1.0', () => {
    const signals = { timesAdded: 100, lastAddedAt: now, storeIds: ['s_1'] };
    expect(searchScore(prepareQuery('milk'), milk, signals, 's_1', now)?.score).toBeCloseTo(1.0);
  });

  it('returns null when matchQuality is null', () => {
    expect(searchScore(prepareQuery('zzzz'), milk, EMPTY_SIGNALS, 's_1', now)).toBeNull();
  });
});

describe('compareMatches — deterministic ordering', () => {
  const base = { nameNorm: 'same', id: 'a' };
  it('sorts by score desc, then quality desc, then name, then id', () => {
    expect(compareMatches({ ...base, score: 0.9, quality: 0.9 }, { ...base, id: 'b', score: 0.5, quality: 0.9 })).toBeLessThan(0);
    expect(compareMatches({ ...base, score: 0.9, quality: 0.95 }, { ...base, id: 'b', score: 0.9, quality: 0.7 })).toBeLessThan(0);
    expect(compareMatches({ ...base, nameNorm: 'a', score: 0.9, quality: 0.9 }, { ...base, id: 'b', nameNorm: 'b', score: 0.9, quality: 0.9 })).toBeLessThan(0);
    expect(compareMatches({ ...base, nameNorm: 'b', score: 0.9, quality: 0.9 }, { ...base, id: 'b', nameNorm: 'a', score: 0.9, quality: 0.9 })).toBeGreaterThan(0);
    expect(compareMatches({ ...base, score: 0.9, quality: 0.9 }, { ...base, id: 'b', score: 0.9, quality: 0.9 })).toBeLessThan(0);
    expect(compareMatches({ ...base, id: 'b', score: 0.9, quality: 0.9 }, { ...base, score: 0.9, quality: 0.9 })).toBeGreaterThan(0);
  });
});

describe('resolveItem — §6.4 dedupe decision (G2.2, G2.5)', () => {
  const suggestions: ResolveCandidate[] = [
    { id: 'i_1', name: 'Basmati Rice', score: 0.97 },
    { id: 'i_2', name: 'Rice Flour', score: 0.91 },
    { id: 'i_3', name: 'Rice', score: 0.62 },
    { id: 'i_4', name: 'Rice Cake', score: 0.4 },
    { id: 'i_5', name: 'Rice Paper', score: 0.3 },
    { id: 'i_6', name: 'Rice Noodle', score: 0.2 },
  ];

  it('exact name hit wins over everything (confidence 1.0)', () => {
    expect(resolveItem({ id: 'i_9' }, { id: 'i_1' }, suggestions)).toEqual({ kind: 'exact', itemId: 'i_9' });
  });

  it('alias hit wins over fuzzy', () => {
    expect(resolveItem(null, { id: 'i_1' }, suggestions)).toEqual({ kind: 'alias', itemId: 'i_1' });
  });

  it('best fuzzy score ≥ 0.90 → near-duplicate, capped at 5 suggestions', () => {
    const decision = resolveItem(null, null, suggestions);
    expect(decision.kind).toBe('near-duplicate');
    if (decision.kind === 'near-duplicate') {
      expect(decision.suggestions).toHaveLength(5);
      expect(decision.suggestions[0]?.id).toBe('i_1');
    }
  });

  it('best fuzzy score just below the threshold → create', () => {
    const below: ResolveCandidate[] = [{ id: 'i_1', name: 'Basmati Rice', score: NEAR_DUPLICATE_THRESHOLD - 0.01 }];
    expect(resolveItem(null, null, below)).toEqual({ kind: 'create' });
  });

  it('exactly 0.90 is a near-duplicate (threshold is inclusive)', () => {
    const at: ResolveCandidate[] = [{ id: 'i_1', name: 'X', score: NEAR_DUPLICATE_THRESHOLD }];
    expect(resolveItem(null, null, at).kind).toBe('near-duplicate');
  });

  it('no candidates → create', () => {
    expect(resolveItem(null, null, [])).toEqual({ kind: 'create' });
  });
});

describe('ftsPhraseQueries — FTS5 prefilter strings (ADR-0002)', () => {
  it('builds quoted per-token phrase conjunctions per canonical form', () => {
    expect(ftsPhraseQueries('milk powder')).toEqual({ norm: '"milk" "powder"', folded: '"milk" "powder"' });
    // 'dood' folds to 'dud', so the two sides genuinely differ
    expect(ftsPhraseQueries('dood')).toEqual({ norm: '"dood"', folded: '"dud"' });
  });

  it('drops tokens under 3 codepoints (trigram minimum)', () => {
    expect(ftsPhraseQueries('ab milk')).toEqual({ norm: '"milk"', folded: '"milk"' });
  });

  it('Devanagari norms mangle below the trigram minimum → both sides null', () => {
    expect(ftsPhraseQueries('दूध')).toEqual({ norm: null, folded: null });
    expect(ftsPhraseQueries('प्याज़')).toEqual({ norm: null, folded: null });
  });

  it('escapes embedded quotes and drops empty queries', () => {
    expect(ftsPhraseQueries('mi"lk')).toEqual({ norm: null, folded: null });
    expect(ftsPhraseQueries('!!!')).toEqual({ norm: null, folded: null });
  });
});
