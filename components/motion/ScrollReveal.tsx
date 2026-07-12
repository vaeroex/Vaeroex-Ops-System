"use client";

import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode
} from "react";

type ScrollRevealProps = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  delayMs?: number;
  disabled?: boolean;
  threshold?: number;
  y?: number;
};

export function ScrollReveal({
  as = "div",
  children,
  className,
  delayMs = 0,
  disabled = false,
  threshold = 0.16,
  y = 18
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const delayTimeoutRef = useRef<number | null>(null);
  const visibilityFallbackRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [delayActive, setDelayActive] = useState(false);
  const [motionDisabled, setMotionDisabled] = useState(disabled);

  useEffect(() => {
    const node = ref.current;

    if (!node || disabled) {
      setIsVisible(true);
      setDelayActive(false);
      setMotionDisabled(true);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      setDelayActive(false);
      setMotionDisabled(true);
      return;
    }

    setMotionDisabled(false);
    setDelayActive(true);
    setIsVisible(false);

    // Reveal content even when a browser pauses or misses intersection events.
    visibilityFallbackRef.current = window.setTimeout(() => setIsVisible(true), Math.max(1400, delayMs + 900));

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          delayTimeoutRef.current = window.setTimeout(() => setDelayActive(false), delayMs + 720);
          observer.disconnect();
        }
      },
      {
        rootMargin: "0px 0px -8% 0px",
        threshold
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();

      if (delayTimeoutRef.current) {
        window.clearTimeout(delayTimeoutRef.current);
      }

      if (visibilityFallbackRef.current) {
        window.clearTimeout(visibilityFallbackRef.current);
      }
    };
  }, [delayMs, disabled, threshold]);

  const style: CSSProperties | undefined = motionDisabled
    ? undefined
    : {
        "--vaeroex-reveal-delay": isVisible && delayActive ? `${delayMs}ms` : "0ms",
        "--vaeroex-reveal-opacity": isVisible ? "1" : "0",
        "--vaeroex-reveal-y": isVisible ? "0px" : `${y}px`
      } as CSSProperties;
  const revealClassName = motionDisabled ? className : ["vaeroex-scroll-reveal", className].filter(Boolean).join(" ");

  return createElement(as, { ref, className: revealClassName, style }, children);
}
