import { useEffect, useRef, useState, type RefObject } from "react";
import { isReducedMotionPreferred } from "./useCountUp.ts";

export interface UseInViewOptions extends IntersectionObserverInit {
  triggerOnce?: boolean;
}

/**
 * Tracks element visibility in the viewport.
 * Honors prefers-reduced-motion (defaults to true instantly).
 * Disconnects on unmount or after triggering if triggerOnce is true.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = { triggerOnce: true, threshold: 0.1 }
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState<boolean>(() => {
    // If running in SSR or reduced motion preferred, render in visible state
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return true;
    if (isReducedMotionPreferred()) return true;
    return false;
  });

  const { triggerOnce = true, threshold = 0.1, root, rootMargin } = options;

  useEffect(() => {
    if (isReducedMotionPreferred()) {
      setIsInView(true);
      return;
    }

    const node = ref.current;
    if (!node || typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            if (triggerOnce) {
              observer.unobserve(entry.target);
            }
          } else if (!triggerOnce) {
            setIsInView(false);
          }
        }
      },
      { threshold, root, rootMargin }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [triggerOnce, threshold, root, rootMargin]);

  return [ref, isInView];
}
