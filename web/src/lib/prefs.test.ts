import { describe, expect, it } from 'vitest';
import { colorSchema } from '@kirana/shared';
import { MEMBER_COLORS } from './memberColors.js';
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  THEME_KEY,
  type ThemePreference,
} from './theme.js';
import {
  ADD_COACH_MARK_KEY,
  dismissAddCoachMark,
  isAddCoachMarkDismissed,
} from './coachmark.js';

function fakeStorage(initial: Record<string, string> = {}): {
  store: Map<string, string>;
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
  };
}

describe('member color palette (§8.9 step 3)', () => {
  it('is a fixed set of schema-valid hex colors', () => {
    expect(MEMBER_COLORS).toHaveLength(8);
    for (const color of MEMBER_COLORS) {
      expect(colorSchema.safeParse(color).success).toBe(true);
    }
  });

  it('leads with the §8.2 default indigo', () => {
    expect(MEMBER_COLORS[0]).toBe('#4F46E5');
  });
});

describe('theme preference (§8.2 dark mode overridable in Settings)', () => {
  it('defaults to system when nothing is stored', () => {
    const { storage } = fakeStorage();
    expect(loadThemePreference(storage)).toBe('system');
  });

  it('round-trips light and dark, ignoring unknown values', () => {
    const { storage } = fakeStorage();
    for (const preference of ['light', 'dark'] as const) {
      saveThemePreference(storage, preference);
      expect(loadThemePreference(storage)).toBe(preference);
    }
    storage.setItem(THEME_KEY, 'sepia');
    expect(loadThemePreference(storage)).toBe('system');
  });

  it('saving system removes the key so the media query wins again', () => {
    const { storage } = fakeStorage({ [THEME_KEY]: 'dark' });
    saveThemePreference(storage, 'system');
    expect(storage.getItem(THEME_KEY)).toBeNull();
  });
});

describe('applyThemePreference', () => {
  const el = (() => {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    };
  })();

  it('sets data-theme for explicit preferences', () => {
    for (const preference of ['light', 'dark'] as const) {
      applyThemePreference(preference, el);
      expect(el.attrs.get('data-theme')).toBe(preference satisfies ThemePreference);
    }
  });

  it('removes data-theme for system', () => {
    applyThemePreference('dark', el);
    applyThemePreference('system', el);
    expect(el.attrs.has('data-theme')).toBe(false);
  });
});

describe('add coach-mark (§8.9 step 6)', () => {
  it('starts undismissed and stays dismissed forever once set', () => {
    const { storage } = fakeStorage();
    expect(isAddCoachMarkDismissed(storage)).toBe(false);
    dismissAddCoachMark(storage);
    expect(storage.getItem(ADD_COACH_MARK_KEY)).toBe('1');
    expect(isAddCoachMarkDismissed(storage)).toBe(true);
  });
});
