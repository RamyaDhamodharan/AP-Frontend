import { useEffect, useRef } from "react";
import type { ElementType, HTMLAttributes, ReactNode } from "react";

/**
 * Initializes global IntersectionObserver + MutationObserver
 * to smoothly reveal elements with the `.scroll-reveal` class as they scroll into view.
 */
export function initScrollReveal(): () => void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      root: null, // viewport or ancestor
      rootMargin: "0px 0px -25px 0px", // Trigger slightly before hitting the bottom
      threshold: 0.08,
    }
  );

  const observeElements = (root: ParentNode = document) => {
    const elements = root.querySelectorAll<HTMLElement>(".scroll-reveal:not(.is-revealed)");
    elements.forEach((el) => observer.observe(el));
  };

  // Initial observation
  observeElements();

  // Watch for dynamic DOM additions (e.g. data load, tab changes, route switches)
  const mutationObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldCheck = true;
        break;
      }
    }
    if (shouldCheck) {
      observeElements();
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
  };
}

/**
 * React hook to trigger reveal detection on mount or when dependencies change.
 */
export function useScrollReveal(deps: unknown[] = []) {
  useEffect(() => {
    const cleanup = initScrollReveal();
    return cleanup;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface ScrollRevealProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  variant?: "up" | "down" | "left" | "right" | "scale";
  delay?: number; // delay in ms
  stagger?: boolean;
  as?: ElementType;
  className?: string;
}

/**
 * Reusable ScrollReveal wrapper component.
 */
export function ScrollReveal({
  children,
  variant = "up",
  delay,
  stagger = false,
  as: Component = "div",
  className = "",
  style,
  ...props
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-revealed");
          observer.unobserve(el);
        }
      },
      {
        threshold: 0.08,
        rootMargin: "0px 0px -25px 0px",
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const variantClass = variant !== "up" ? `reveal-${variant}` : "";
  const staggerClass = stagger ? "reveal-stagger" : "";
  const delayStyle = delay ? { transitionDelay: `${delay}ms` } : {};

  return (
    <Component
      ref={ref}
      className={`scroll-reveal ${variantClass} ${staggerClass} ${className}`.trim()}
      style={{ ...delayStyle, ...style }}
      {...props}
    >
      {children}
    </Component>
  );
}
