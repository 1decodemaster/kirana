/** §8.9 step 6: the coach-mark on the `+` is dismissed forever after the
 * first successful add. Storage is injected so tests stay deterministic. */
export const ADD_COACH_MARK_KEY = 'kirana.coachmark.add';

import type { KeyValueStore } from './theme.js';

export function isAddCoachMarkDismissed(storage: KeyValueStore): boolean {
  return storage.getItem(ADD_COACH_MARK_KEY) === '1';
}

export function dismissAddCoachMark(storage: KeyValueStore): void {
  storage.setItem(ADD_COACH_MARK_KEY, '1');
}
