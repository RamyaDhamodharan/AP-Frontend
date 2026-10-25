import { useEffect, useState } from "react";

/**
 * Pure easing and interpolation helper for count up animation.
 * Progress is between 0 and 1. Uses ease-out cubic.
 */
export function calculateCountUp(start: number, end: number, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  const easeOutCubic = 1 - Math.pow(1 - clamped, 3);
  return start + (end - start) * easeOutCubic;
}

export function isReducedMotionPreferred(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts up a numeric value smoothly over durationMs (default 600ms).
 * Tabular numerals, respects prefers-reduced-motion by snapping instantly to target.
 */
export function useCountUp(
  targetValue: number,
  durationMs = 600,
  options?: { startValue?: number; decimals?: number }
): number {
  const [displayValue, setDisplayValue] = useState<number>(() => {
    if (isReducedMotionPreferred()) return targetValue;
    return options?.startValue ?? 0;
  });

  useEffect(() => {
    if (isReducedMotionPreferred()) {
      setDisplayValue(targetValue);
      return;
    }

    const start = options?.startValue ?? 0;
    const end = targetValue;
    if (start === end) {
      setDisplayValue(end);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const current = calculateCountUp(start, end, progress);
      const rounded = options?.decimals != null
        ? Number(current.toFixed(options.decimals))
        : Math.round(current);

      setDisplayValue(rounded);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [targetValue, durationMs, options?.startValue, options?.decimals]);

  return displayValue;
}
