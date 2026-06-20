"use client";

import { useEffect, useRef, useState } from "react";

type AnimatedMetricProps = {
  label: string;
  value: number;
  className?: string;
  delayMs?: number;
  durationMs?: number;
  from?: number;
  helper?: string;
  prefix?: string;
  precision?: number;
  suffix?: string;
};

function formatMetric(value: number, precision: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision
  });
}

export function AnimatedMetric({
  label,
  value,
  className,
  delayMs = 0,
  durationMs = 980,
  from = 0,
  helper,
  prefix = "",
  precision = 0,
  suffix = ""
}: AnimatedMetricProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const [displayValue, setDisplayValue] = useState(from);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      setDisplayValue(value);
      return;
    }

    const startAnimation = () => {
      const startTime = performance.now();

      const tick = (time: number) => {
        const progress = Math.min((time - startTime) / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        setDisplayValue(from + (value - from) * eased);

        if (progress < 1) {
          frameRef.current = window.requestAnimationFrame(tick);
        }
      };

      timeoutRef.current = window.setTimeout(() => {
        frameRef.current = window.requestAnimationFrame(tick);
      }, delayMs);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          startAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.36 }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [delayMs, durationMs, from, value]);

  return (
    <div ref={ref} className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-vaeroex-blue">
        {prefix}
        {formatMetric(displayValue, precision)}
        {suffix}
      </p>
      {helper ? <p className="mt-2 text-sm leading-6 text-muted">{helper}</p> : null}
    </div>
  );
}
