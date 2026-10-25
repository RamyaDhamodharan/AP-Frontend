import type { CSSProperties } from "react";
import { isReducedMotionPreferred } from "./useCountUp.ts";

/**
 * Computes stagger delay in ms for a given item index.
 * Respects maximum delay cap to prevent long waits on large collections.
 */
export function computeStaggerDelay(index: number, stepMs = 30, maxDelayMs = 300): number {
  if (index <= 0) return 0;
  return Math.min(index * stepMs, maxDelayMs);
}

/**
 * Hook to provide staggered animation and transition delays.
 * Returns CSSProperties style object with animationDelay and transitionDelay.
 * Instant (0ms) when prefers-reduced-motion is active.
 */
export function useStagger(
  index: number,
  stepMs = 30,
  maxDelayMs = 300
): CSSProperties {
  if (isReducedMotionPreferred()) {
    return {
      animationDelay: "0ms",
      transitionDelay: "0ms",
    };
  }

  const delay = computeStaggerDelay(index, stepMs, maxDelayMs);
  return {
    animationDelay: `${delay}ms`,
    transitionDelay: `${delay}ms`,
  };
}
