"use client";

import { useEffect, useState, type RefObject } from "react";

export function useSpatialVisibility<T extends HTMLElement>(hostRef: RefObject<T | null>) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        setVisible(
          document.visibilityState !== "hidden"
          && bounds.bottom > 0
          && bounds.top < window.innerHeight
          && bounds.right > 0
          && bounds.left < window.innerWidth
        );
      });
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(measure, { threshold: 0.02 });

    observer?.observe(element);
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    document.addEventListener("visibilitychange", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      document.removeEventListener("visibilitychange", measure);
    };
  }, [hostRef]);

  return visible;
}
