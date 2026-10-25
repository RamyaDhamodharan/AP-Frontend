import test from "node:test";
import assert from "node:assert/strict";
import { calculateCountUp, isReducedMotionPreferred } from "../src/motion/useCountUp.ts";
import { computeStaggerDelay } from "../src/motion/useStagger.ts";

test("calculateCountUp eases out cubic smoothly", () => {
  // start = 0, end = 100
  assert.equal(calculateCountUp(0, 100, 0), 0);
  assert.equal(calculateCountUp(0, 100, 1), 100);

  // At progress 0.5: 1 - (1 - 0.5)^3 = 1 - 0.125 = 0.875 -> 87.5
  const mid = calculateCountUp(0, 100, 0.5);
  assert.equal(mid, 87.5);

  // Clamping check
  assert.equal(calculateCountUp(0, 100, -0.2), 0);
  assert.equal(calculateCountUp(0, 100, 1.5), 100);
});

test("computeStaggerDelay calculates delays and caps at maxDelayMs", () => {
  assert.equal(computeStaggerDelay(0, 30, 300), 0);
  assert.equal(computeStaggerDelay(1, 30, 300), 30);
  assert.equal(computeStaggerDelay(5, 30, 300), 150);
  assert.equal(computeStaggerDelay(10, 30, 300), 300);
  // Beyond cap:
  assert.equal(computeStaggerDelay(20, 30, 300), 300);
});

test("isReducedMotionPreferred returns false when window is undefined", () => {
  // In node environment without window, should return false safely
  assert.equal(isReducedMotionPreferred(), false);
});

test("reduced motion handling honors prefers-reduced-motion media query", () => {
  // Mock window.matchMedia
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  };

  assert.equal(isReducedMotionPreferred(), true);

  // Clean up global mock
  delete globalThis.window;
});
