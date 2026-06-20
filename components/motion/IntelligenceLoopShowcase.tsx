"use client";

import { useEffect, useRef, useState } from "react";

type IntelligenceLoopShowcaseProps = {
  steps: ReadonlyArray<readonly [string, string]>;
};

export function IntelligenceLoopShowcase({ steps }: IntelligenceLoopShowcaseProps) {
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [motionDisabled, setMotionDisabled] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      setMotionDisabled(true);
      setActiveIndex(steps.length - 1);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        const index = Number(visible?.target.getAttribute("data-loop-step"));

        if (Number.isFinite(index)) {
          setActiveIndex(index);
        }
      },
      {
        rootMargin: "-18% 0px -38% 0px",
        threshold: [0.28, 0.45, 0.62]
      }
    );

    stepRefs.current.forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });

    return () => observer.disconnect();
  }, [steps.length]);

  const progress = motionDisabled ? "100%" : `${((activeIndex + 1) / steps.length) * 100}%`;

  return (
    <div className="relative rounded-lg border border-line bg-slate-50 p-4 shadow-panel">
      <div className="absolute bottom-8 left-8 top-8 hidden w-px overflow-hidden bg-slate-200 md:block">
        <span
          className="block w-px bg-gradient-to-b from-vaeroex-blue to-vaeroex-accent transition-[height] duration-500 ease-out"
          style={{ height: progress }}
        />
      </div>
      <div className="grid gap-3">
        {steps.map(([title, description], index) => {
          const isActive = motionDisabled || index <= activeIndex;

          return (
            <div
              key={title}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              data-loop-step={index}
              className={[
                "group relative rounded-lg border bg-white p-4 shadow-sm transition duration-300 md:ml-8",
                isActive ? "border-vaeroex-blue/35 shadow-panel" : "border-line opacity-75"
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <span
                  className={[
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition duration-300",
                    isActive ? "border-vaeroex-blue bg-vaeroex-blue text-white" : "border-line bg-slate-50 text-muted"
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
