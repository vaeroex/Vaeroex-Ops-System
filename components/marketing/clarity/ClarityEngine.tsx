"use client";

import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./ClarityEngine.module.css";
import type { ClarityVariant } from "./clarityMotion";
import type { ScienceKind } from "../science/scienceTypes";
export type JourneyVariant = ClarityVariant | ScienceKind;
import { clarityDevicePolicy } from "./clarityDevicePolicy";

const EngineCanvas = dynamic(() => import("./ClarityEngineCanvas"), {
  ssr: false,
});
const ScientificCanvas = dynamic(() => import("../science/ScientificCanvas"), {
  ssr: false,
});

type RenderMode = "pending" | "interactive" | "poster";
type DeviceNavigator = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** A real-time sculpture with an independent, server-rendered image fallback. */
export function ClarityEngine({
  className = "",
  journeyId,
  variant = "home",
  chapters = [],
}: {
  className?: string;
  journeyId?: string;
  variant?: JourneyVariant;
  chapters?: Array<{ label: string; id: string }>;
}) {
  const scientific = variant === "drug-discovery" || variant === "biology";
  const sceneName =
    variant === "drug-discovery"
      ? "Molecular journey"
      : variant === "biology"
        ? "Cellular journey"
        : "Clarity Engine";
  const container = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode>("pending");
  const [reason, setReason] = useState("loading");
  const [nearViewport, setNearViewport] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [compact, setCompact] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!journeyId || !inViewport || !pageVisible || paused) return;
    const journey = document.getElementById(journeyId);
    if (!journey) return;
    const sections = Array.from(
      journey.querySelectorAll<HTMLElement>("[data-clarity-chapter]"),
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      const visual = container.current?.getBoundingClientRect();
      // Align motion to actual story centers, including variable mobile copy heights.
      const narrowLayout = window.matchMedia(
        "(max-width: 767px) and (min-height: 501px)",
      ).matches;
      const focus =
        narrowLayout && visual
          ? visual.bottom +
            Math.max(0, window.innerHeight - visual.bottom) * 0.48
          : 86 + (window.innerHeight - 86) * 0.5;
      const anchors = sections.map((section) => {
        const bounds = section.getBoundingClientRect();
        return bounds.top + bounds.height * 0.5 - focus;
      });
      let value = 0;
      if (anchors.length > 1) {
        if (anchors[anchors.length - 1] <= 0) value = 1;
        else {
          for (let index = 0; index < anchors.length - 1; index += 1) {
            if (anchors[index] <= 0 && anchors[index + 1] > 0) {
              value =
                (index +
                  -anchors[index] /
                    Math.max(1, anchors[index + 1] - anchors[index])) /
                (anchors.length - 1);
              break;
            }
          }
        }
      }
      setProgress(value);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(journey);
    sections.forEach((section) => observer?.observe(section));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [journeyId, inViewport, pageVisible, paused, compact]);
  const handleReady = useCallback(() => setReady(true), []);
  const handleFailure = useCallback(() => {
    setMode("poster");
    setReason("rendering-unavailable");
    setReady(false);
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const visibility = () =>
      setPageVisible(document.visibilityState === "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    if (!window.IntersectionObserver) {
      setNearViewport(true);
      setInViewport(true);
      return () => document.removeEventListener("visibilitychange", visibility);
    }
    const preloadObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          preloadObserver.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    const visibilityObserver = new IntersectionObserver(([entry]) =>
      setInViewport(entry.isIntersecting),
    );
    preloadObserver.observe(element);
    visibilityObserver.observe(element);
    return () => {
      preloadObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactQuery = window.matchMedia(
      "(max-width: 767px), (pointer: coarse)",
    );
    let cancelled = false;
    const evaluate = () => {
      if (cancelled) return;
      const device = navigator as DeviceNavigator;
      const policy = clarityDevicePolicy({
        reducedMotion: reducedMotion.matches,
        compact: compactQuery.matches,
        saveData: device.connection?.saveData,
        memory: device.deviceMemory,
        cores: device.hardwareConcurrency,
      });
      setCompact(policy.compact);
      const fallback = policy.fallback;
      if (fallback) {
        setReason(fallback);
        setMode("poster");
        setReady(false);
        return;
      }
      try {
        const probe = document.createElement("canvas");
        const context = probe.getContext("webgl2", {
          failIfMajorPerformanceCaveat: true,
        });
        if (!context) throw new Error("WebGL unavailable");
        const adequate = context.getParameter(context.MAX_TEXTURE_SIZE) >= 4096;
        context.getExtension("WEBGL_lose_context")?.loseContext();
        if (!adequate) throw new Error("Constrained GPU");
        setReason(policy.compact ? "supported-compact" : "supported");
        setMode("interactive");
      } catch {
        setReason("webgl-unavailable");
        setMode("poster");
        setReady(false);
      }
    };
    // The poster and page become usable before any Three.js code is requested.
    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(evaluate, { timeout: 1400 })
        : null;
    const timeout = idle === null ? window.setTimeout(evaluate, 350) : null;
    reducedMotion.addEventListener("change", evaluate);
    compactQuery.addEventListener("change", evaluate);
    return () => {
      cancelled = true;
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timeout !== null) window.clearTimeout(timeout);
      reducedMotion.removeEventListener("change", evaluate);
      compactQuery.removeEventListener("change", evaluate);
    };
  }, [nearViewport]);

  const active = inViewport && pageVisible && !paused;
  const interactive = mode === "interactive" && ready;
  const chapterIndex = Math.min(
    chapters.length - 1,
    Math.round(progress * (chapters.length - 1)),
  );
  return (
    <div
      ref={container}
      className={`${styles.engine} ${className}`}
      data-clarity-engine
      data-clarity-progress={progress.toFixed(4)}
      data-clarity-quality={compact ? "compact" : "full"}
      data-clarity-variant={variant}
      data-clarity-mode={interactive ? "interactive" : "poster"}
      data-clarity-state={mode === "interactive" && !ready ? "loading" : mode}
      data-clarity-reason={reason}
      data-clarity-active={interactive && active ? "true" : "false"}
    >
      <div className={styles.visual} aria-hidden="true">
        {/* A local, optimized art-directed render is also the no-JavaScript experience. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            scientific
              ? `/brand/science/${variant}-poster.webp`
              : "/brand/clarity-engine-poster.webp"
          }
          alt=""
          width="1400"
          height="1400"
          fetchPriority="high"
          decoding="async"
          className={`${styles.poster} ${interactive ? styles.posterHidden : ""}`}
          data-clarity-poster
        />
        {mode === "interactive" ? (
          <SceneBoundary onFailure={handleFailure}>
            {scientific ? (
              <ScientificCanvas
                active={active}
                progress={progress}
                compact={compact}
                variant={variant}
                onReady={handleReady}
                onFailure={handleFailure}
              />
            ) : (
              <EngineCanvas
                active={active}
                progress={progress}
                compact={compact}
                variant={variant}
                onReady={handleReady}
                onFailure={handleFailure}
              />
            )}
          </SceneBoundary>
        ) : null}
        {variant === "drug-discovery" && interactive ? (
          <div
            className={styles.compoundLabels}
            style={{
              opacity: Math.max(0, Math.min(1, (progress - 0.87) / 0.1)),
            }}
          >
            <span>
              AZM<small>Acetazolamide</small>
            </span>
            <span>
              MZM<small>Methazolamide</small>
            </span>
            <span>
              EZL<small>Ethoxzolamide</small>
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.caption}>
        <span className={styles.mode}>
          <span
            className={styles.indicator}
            data-live={interactive && active}
          />
          {interactive ? "SCROLL TO EXPLORE" : sceneName.toUpperCase()}
        </span>
        {interactive ? (
          <button
            type="button"
            className={styles.motionControl}
            onClick={() => setPaused((current) => !current)}
            aria-label={
              paused
                ? `Enable ${sceneName} motion`
                : `Pause ${sceneName} motion`
            }
            aria-pressed={paused}
          >
            {paused ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 3.5 12 8l-7 4.5Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 4v8M11 4v8" />
              </svg>
            )}
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>
        ) : (
          <span className={styles.renderLabel}>CONCEPT RENDER</span>
        )}
      </div>
      {chapters.length > 0 ? (
        <nav
          className={styles.chapters}
          aria-label={
            scientific ? `${sceneName} chapters` : "Clarity journey chapters"
          }
        >
          {chapters.map((chapter, index) => (
            <a
              key={chapter.id}
              href={`#${chapter.id}`}
              aria-label={`${index + 1}. ${chapter.label}`}
              aria-current={chapterIndex === index ? "step" : undefined}
            >
              <span className={styles.chapterLine}>
                <i
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, progress * (chapters.length - 1) - index + 1))})`,
                  }}
                />
              </span>
              <span>0{index + 1}</span>
              <span className={styles.chapterName}>{chapter.label}</span>
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
