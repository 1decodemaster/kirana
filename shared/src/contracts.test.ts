import { describe, expect, it } from 'vitest';
import {
  addListItemRequestSchema,
  boardResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  importRowDtoSchema,
} from './contracts.js';
import { normalizeName } from './normalize.js';
import { parseQty } from './parseQty.js';

const V7 = '01913b5e-7d5a-7000-8000-000000000001';

describe('error envelope (PRD §7.1)', () => {
  it('parses the canonical near-duplicate example', () => {
    const payload = {
      error: {
        code: 'ITEM_NEAR_DUPLICATE',
        message: 'An item with a very similar name already exists.',
        details: { suggestions: [{ id: V7, name: 'Basmati Rice', score: 0.94 }] },
        requestId: '01J8ZC1V3PQ5M2XK7N4P6R8T10',
      },
    };
    expect(errorResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects codes outside the closed set', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'NOPE', message: 'x', requestId: 'r' } }).success,
    ).toBe(false);
  });
});

describe('healthResponseSchema (G0.1)', () => {
  it('requires status, version, revision, uptime', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '0.1.0', revision: 'abc1234', uptime: 1.5 })).toEqual({
      status: 'ok',
      version: '0.1.0',
      revision: 'abc1234',
      uptime: 1.5,
    });
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('addListItemRequestSchema (PRD §7.4)', () => {
  const base = { clientId: V7 };

  it('accepts itemId only', () => {
    expect(addListItemRequestSchema.parse({ ...base, itemId: V7, qtyValue: 2, unitCode: 'l' })).toMatchObject({
      itemId: V7,
      qtyValue: 2,
      unitCode: 'l',
    });
  });

  it('accepts name only', () => {
    expect(addListItemRequestSchema.parse({ ...base, name: 'milk 2 l' })).toMatchObject({ name: 'milk 2 l' });
  });

  it('rejects when both or neither are given', () => {
    expect(addListItemRequestSchema.safeParse({ ...base, itemId: V7, name: 'milk' }).success).toBe(false);
    expect(addListItemRequestSchema.safeParse({ ...base }).success).toBe(false);
  });

  it('strips unknown keys at the boundary (PRD §11)', () => {
    const parsed = addListItemRequestSchema.parse({ ...base, name: 'atta', hacker: true });
    expect(parsed).not.toHaveProperty('hacker');
  });

  it('rejects non-positive quantities (INV-3)', () => {
    expect(addListItemRequestSchema.safeParse({ ...base, name: 'milk', qtyValue: 0 }).success).toBe(false);
    expect(addListItemRequestSchema.safeParse({ ...base, name: 'milk', qtyValue: -2 }).success).toBe(false);
  });
});

describe('boardResponseSchema (PRD §7.3)', () => {
  it('parses the documented shape', () => {
    const payload = {
      revision: 421,
      household: { id: V7, name: 'Home' },
      me: { id: V7, displayName: 'Alex', color: '#4F46E5' },
      members: [{ id: V7, displayName: 'Alex', color: '#4F46E5' }],
      categories: [{ id: V7, name: 'Produce', scope: 'grocery', icon: '🥬', color: '#6B7280', sortOrder: 10 }],
      stores: [
        {
          id: V7,
          name: 'Costco',
          iconKind: 'emoji',
          iconRef: '🏬',
          status: 'active',
          categoryOrder: [],
          sortOrder: 0,
          counts: { total: 12, bought: 5 },
          items: [
            {
              id: V7,
              itemId: V7,
              name: 'Basmati Rice',
              qtyValue: 5,
              unitCode: 'kg',
              categoryId: V7,
              status: 'active',
              note: null,
              addedBy: V7,
              updatedAt: 1730000000000,
            },
          ],
        },
      ],
      catalog: [
        {
          id: V7,
          name: 'Basmati Rice',
          norm: 'basmati rice',
          aliases: ['chawal', 'चावल'],
          defaultUnit: 'kg',
          defaultCategoryId: V7,
          iconRef: '🍚',
        },
      ],
    };
    const parsed = boardResponseSchema.parse(payload);
    expect(parsed.stores[0]?.counts).toEqual({ total: 12, bought: 5 });
  });
});

describe('importRowDtoSchema (PRD §9.3)', () => {
  it('accepts the four row actions', () => {
    for (const action of ['create', 'merge', 'skip', 'error'] as const) {
      expect(
        importRowDtoSchema.parse({
          line: 1,
          store: 'Indian Store',
          category: 'Grains & Lentils',
          name: 'Basmati Rice',
          aliases: ['chawal'],
          qty: 5,
          unit: 'kg',
          note: null,
          action,
          targetItemId: action === 'merge' ? V7 : null,
          targetName: null,
          message: null,
        }).action,
      ).toBe(action);
    }
  });
});

describe('contract coherence with domain utilities', () => {
  it('quick-parsed quantities satisfy the request schema invariants', () => {
    for (const input of ['milk 2 l', 'atta 5kg', '500 g paneer', 'dal 2']) {
      const parsed = parseQty(input);
      expect(parsed).not.toBeNull();
      if (parsed) {
        const request = { clientId: V7, name: parsed.name, qtyValue: parsed.qty, unitCode: parsed.unit };
        expect(addListItemRequestSchema.safeParse(request).success).toBe(true);
      }
    }
  });

  it('name normalization fits the name schema bounds', () => {
    expect(normalizeName('  Basmati Rice ').length).toBeGreaterThan(0);
  });
});
