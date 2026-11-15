/** §8.8: reduced-motion users get instant jumps, never animated scrolling. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** §8.5: the auto-advance scroll animation runs 200 ms, ease-out cubic.
 * Respects prefers-reduced-motion (instant jump). Returns a cancel function
 * so callers can stop the tween on unmount or re-render. */
export function animateScrollTo(targetY: number, durationMs = 200): () => void {
  if (prefersReducedMotion() || durationMs <= 0) {
    window.scrollTo(0, targetY);
    return () => undefined;
  }
  const startY = window.scrollY;
  const delta = targetY - startY;
  if (delta === 0) return () => undefined;
  const start = performance.now();
  let raf = 0;
  let cancelled = false;
  const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
  const step = (now: number): void => {
    if (cancelled) return;
    const t = Math.min((now - start) / durationMs, 1);
    window.scrollTo(0, startY + delta * easeOutCubic(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
