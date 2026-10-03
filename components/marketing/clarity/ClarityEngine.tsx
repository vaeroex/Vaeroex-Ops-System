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

const EngineCanvas = dynamic(() => import("./ClarityEngineCanvas"), {
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
export function ClarityEngine({ className = "" }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode>("pending");
  const [reason, setReason] = useState("loading");
  const [nearViewport, setNearViewport] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
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
    const compact = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    let cancelled = false;
    const evaluate = () => {
      if (cancelled) return;
      const device = navigator as DeviceNavigator;
      const fallback = reducedMotion.matches
        ? "reduced-motion"
        : compact.matches
          ? "compact-device"
          : device.connection?.saveData ||
              (device.deviceMemory && device.deviceMemory <= 4) ||
              (device.hardwareConcurrency && device.hardwareConcurrency <= 4)
            ? "low-power"
            : null;
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
        setReason("supported");
        setMode("interactive");
      } catch {
        setReason("webgl-unavailable");
        setMode("poster");
      }
    };
    // The poster and page become usable before any Three.js code is requested.
    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(evaluate, { timeout: 1400 })
        : null;
    const timeout = idle === null ? window.setTimeout(evaluate, 350) : null;
    reducedMotion.addEventListener("change", evaluate);
    compact.addEventListener("change", evaluate);
    return () => {
      cancelled = true;
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timeout !== null) window.clearTimeout(timeout);
      reducedMotion.removeEventListener("change", evaluate);
      compact.removeEventListener("change", evaluate);
    };
  }, [nearViewport]);

  const active = inViewport && pageVisible && !paused;
  const interactive = mode === "interactive" && ready;
  return (
    <div
      ref={container}
      className={`${styles.engine} ${className}`}
      data-clarity-engine
      data-clarity-mode={interactive ? "interactive" : "poster"}
      data-clarity-state={mode === "interactive" && !ready ? "loading" : mode}
      data-clarity-reason={reason}
      data-clarity-active={interactive && active ? "true" : "false"}
    >
      <div className={styles.visual} aria-hidden="true">
        {/* A local, optimized art-directed render is also the no-JavaScript experience. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/clarity-engine-poster.webp"
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
            <EngineCanvas
              active={active}
              onReady={handleReady}
              onFailure={handleFailure}
            />
          </SceneBoundary>
        ) : null}
      </div>
      <div className={styles.caption}>
        <span className={styles.mode}>
          <span
            className={styles.indicator}
            data-live={interactive && active}
          />
          {interactive ? "REAL-TIME STRUCTURE" : "THE CLARITY ENGINE"}
        </span>
        {interactive ? (
          <button
            type="button"
            className={styles.motionControl}
            onClick={() => setPaused((current) => !current)}
            aria-label={
              paused
                ? "Enable Clarity Engine motion"
                : "Pause Clarity Engine motion"
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
    </div>
  );
}
