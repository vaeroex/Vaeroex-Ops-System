"use client";

import { useEffect, useRef, useState } from "react";

const storySteps = [
  ["Scattered Information", "Reports, spreadsheets, customer activity, files, and operational updates live in disconnected places."],
  ["Limited Visibility", "Leaders struggle to understand what is happening across the business."],
  ["Reactive Decisions", "Problems are often discovered late, after opportunities are missed or issues grow."],
  ["Operations Intelligence", "Vaeroex connects context, performance, risk, and evidence-backed recommendations."],
  ["Leadership Clarity", "Insights become clearer briefings, better questions, and stronger decisions."]
] as const;

const signalCards = ["Reports", "KPIs", "Customer Activity", "Files", "Evidence", "Issues"];

export function ScrollStory() {
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [motionDisabled, setMotionDisabled] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      setMotionDisabled(true);
      setActiveIndex(storySteps.length - 1);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const index = Number(visible?.target.getAttribute("data-story-step"));

        if (Number.isFinite(index)) {
          setActiveIndex(index);
        }
      },
      {
        rootMargin: "-20% 0px -44% 0px",
        threshold: [0.32, 0.48, 0.66]
      }
    );

    stepRefs.current.forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });

    return () => observer.disconnect();
  }, []);

  const connected = motionDisabled || activeIndex >= 3;

  return (
    <section className="border-y border-line bg-white px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">From scattered signals to execution</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex turns disconnected activity into a structured intelligence loop.</h2>
          <div className="mt-6 grid gap-4">
            {storySteps.map(([title, description], index) => {
              const isActive = motionDisabled || index === activeIndex;

              return (
                <div
                  key={title}
                  ref={(node) => {
                    stepRefs.current[index] = node;
                  }}
                  data-story-step={index}
                  className={[
                    "rounded-lg border p-4 transition duration-300",
                    isActive ? "border-vaeroex-blue bg-vaeroex-soft shadow-sm" : "border-line bg-slate-50"
                  ].join(" ")}
                >
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="sticky top-24 rounded-xl border border-line bg-slate-50 p-5 shadow-panel">
          <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-line bg-white p-4">
            <div className={["absolute inset-0 transition duration-500", connected ? "opacity-100" : "opacity-0"].join(" ")}>
              <svg className="h-full w-full" viewBox="0 0 420 360" aria-hidden="true">
                <path className="vaeroex-network-line" d="M72 72 C150 110 250 86 335 126" fill="none" stroke="#1E6BFF" strokeWidth="2" strokeDasharray="5 8" />
                <path className="vaeroex-network-line" d="M70 258 C160 214 246 246 338 206" fill="none" stroke="#38BDF8" strokeWidth="2" strokeDasharray="5 8" />
                <path className="vaeroex-network-line" d="M110 180 C190 130 250 164 318 180" fill="none" stroke="#0B1F4D" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="5 8" />
              </svg>
            </div>
            <div className="relative grid h-full min-h-[380px] grid-cols-2 content-between gap-3">
              {signalCards.map((signal, index) => {
                const shouldGroup = connected || index <= activeIndex;

                return (
                  <div
                    key={signal}
                    className={[
                      "rounded-lg border p-3 text-sm font-semibold shadow-sm transition duration-500",
                      shouldGroup ? "border-vaeroex-blue/30 bg-vaeroex-soft text-vaeroex-blue" : "border-line bg-slate-50 text-muted",
                      connected ? "translate-y-0" : index % 2 === 0 ? "-translate-y-1" : "translate-y-2"
                    ].join(" ")}
                  >
                    {signal}
                  </div>
                );
              })}
              <div className="col-span-2 rounded-lg border border-vaeroex-blue/30 bg-vaeroex-navy p-4 text-white shadow-command">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Vaeroex intelligence layer</p>
                <p className="mt-2 text-lg font-semibold">Visibility becomes accountability. Accountability becomes execution.</p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Visual storytelling preview. Each source remains understandable without animation.</p>
        </div>
      </div>
    </section>
  );
}
