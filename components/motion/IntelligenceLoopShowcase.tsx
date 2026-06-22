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
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#08111f]/90 p-4 shadow-command">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_28%,rgba(56,189,248,0.16),transparent_32%),radial-gradient(circle_at_16%_82%,rgba(168,85,247,0.12),transparent_34%)]" />
      <div className="absolute bottom-8 left-8 top-8 hidden w-px overflow-hidden bg-white/10 md:block">
        <span
          className="block w-px bg-gradient-to-b from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 transition-[height] duration-500 ease-out"
          style={{ height: progress }}
        />
      </div>
      <div className="relative grid gap-3">
        {steps.map(([title, description], index) => {
          const isActive = motionDisabled || index <= activeIndex;
          const isPredict = title === "Predict";

          return (
            <div
              key={title}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              data-loop-step={index}
              className={[
                "group relative rounded-lg border bg-white/[0.06] p-4 shadow-sm transition duration-300 md:ml-8",
                isPredict ? "overflow-hidden" : "",
                isActive ? "border-vaeroex-blue/35 shadow-command" : "border-white/10 opacity-75"
              ].join(" ")}
            >
              {isPredict ? (
                <span className="pointer-events-none absolute right-4 top-4 h-10 w-10 rounded-full border border-vaeroex-accent/35 bg-vaeroex-accent/10 shadow-[0_0_28px_rgba(56,189,248,0.35)] motion-safe:animate-pulse" />
              ) : null}
              <div className="flex items-start gap-3">
                <span
                  className={[
                    "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition duration-300",
                    isPredict && isActive ? "border-vaeroex-accent bg-vaeroex-accent text-vaeroex-navy shadow-[0_0_24px_rgba(56,189,248,0.45)]" : isActive ? "border-vaeroex-blue bg-vaeroex-blue text-white" : "border-white/15 bg-white/5 text-slate-400"
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
