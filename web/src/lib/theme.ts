/** §8.2: dark mode follows prefers-color-scheme, overridable in Settings.
 * The override is a data-theme attribute on <html>; 'system' removes it so
 * the media query in tokens.css decides. */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'kirana.theme';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadThemePreference(storage: KeyValueStore): ThemePreference {
  const raw = storage.getItem(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function saveThemePreference(storage: KeyValueStore, preference: ThemePreference): void {
  if (preference === 'system') storage.removeItem(THEME_KEY);
  else storage.setItem(THEME_KEY, preference);
}

interface ThemeElement {
  setAttribute(qualifiedName: string, value: string): void;
  removeAttribute(qualifiedName: string): void;
}

export function applyThemePreference(preference: ThemePreference, element: ThemeElement): void {
  if (preference === 'system') element.removeAttribute('data-theme');
  else element.setAttribute('data-theme', preference);
}
