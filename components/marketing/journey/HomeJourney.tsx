"use client";
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clarityDevicePolicy } from "../clarity/clarityDevicePolicy";
import { logoBounds, logoPieces, type LogoPoint } from "./logoOutline";
import styles from "./HomeJourney.module.css";
const Scene = dynamic(() => import("./JourneyCanvas"), { ssr: false });
const anchors = [
  ["home-opening", 0], ["solutions", .14], ["featured-product", .30],
  ["home-custom", .50], ["home-websites", .70],
  ["project-process-title", .84], ["home-finish", 1],
] as const;
class Boundary extends Component<{
  children: ReactNode;
  onFailure: () => void;
}, {
  failed: boolean;
}> {
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
/** Always present in server HTML, including without JavaScript or WebGL. */
function Poster() {
  // The front faces use the shared source-image trace without altering any edge.
  // A shallow extrusion supplies depth while preserving the completed mark.
  const scale = logoBounds.worldWidth / logoBounds.width;
  const point = ([x,y]: LogoPoint, depth = 0) =>
    `${(x - logoBounds.minX) * scale + depth * .77},${(y - logoBounds.minY) * scale + depth * .94}`;
  const points = (vertices: LogoPoint[], depth = 0) => vertices.map(vertex => point(vertex,depth)).join(" ");
  return <svg
    viewBox={`-1.03 -1.03 51.08 ${logoBounds.worldHeight + 3.08}`}
    fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet"
  >
    <defs>
      <linearGradient id="journey-logo-metal" x1="3.25" y1="-.04" x2="37.48" y2="31.62" gradientUnits="userSpaceOnUse">
        <stop stopColor="#c4d5e2" />
        <stop offset=".28" stopColor="#608aa7" />
        <stop offset=".64" stopColor="#334c64" />
        <stop offset="1" stopColor="#9bb6cd" />
      </linearGradient>
      <linearGradient id="journey-logo-blue" x1="22.50" y1="8.51" x2="48.17" y2="32.04" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--public-interactive)" />
        <stop offset=".45" stopColor="var(--public-blue)" />
        <stop offset="1" stopColor="#07516a" />
      </linearGradient>
      <linearGradient id="journey-logo-edge" x1="9.67" y1="6.37" x2="41.75" y2="32.04" gradientUnits="userSpaceOnUse">
        <stop stopColor="#263b50" />
        <stop offset=".55" stopColor="#0d1926" />
        <stop offset="1" stopColor="#3b5268" />
      </linearGradient>
    </defs>
    {logoPieces.map(piece => <g key={piece.id} strokeLinejoin="round">
      <polygon points={points(piece.points,1)} fill="#101e2d" stroke="#34485c" strokeWidth=".043" />
      {piece.points.map((vertex,index) => {
        const next = piece.points[(index+1)%piece.points.length];
        return <polygon key={index}
          points={`${point(vertex)} ${point(next)} ${point(next,1)} ${point(vertex,1)}`}
          fill="url(#journey-logo-edge)" stroke="#3f5970" strokeWidth=".034" />;
      })}
    </g>)}
    {logoPieces.map(piece => <polygon key={piece.id}
      data-logo-piece={piece.id}
      points={points(piece.points)}
      fill={piece.id === "right-base" || piece.id === "right-rail" ? "url(#journey-logo-blue)" : "url(#journey-logo-metal)"}
      stroke="#a9cbe4" strokeWidth=".060" strokeLinejoin="round"
    />)}
  </svg>;
}
export function HomeJourney() {
  const ref = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false), [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true), [compact, setCompact] = useState(false);
  const [allowed, setAllowed] = useState(false), [failed, setFailed] = useState(false);
  const [staticView, setStaticView] = useState(false), [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0), [reason, setReason] = useState("loading");
  const [finalShift, setFinalShift] = useState(0);
  const onReady = useCallback(() => setReady(true), []);
  const onFailure = useCallback(() => {
    setFailed(true);
    setReady(false);
    setReason("rendering-unavailable");
  }, []);
  const interactive = allowed && !failed && !staticView;
  const active = visible && pageVisible && interactive;
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)"), small = matchMedia("(max-width: 760px)");
    const evaluate = () => {
      const n = navigator as Navigator & {
        deviceMemory?: number;
        connection?: {
          saveData?: boolean;
        };
      };
      const policy = clarityDevicePolicy({
        reducedMotion: motion.matches, compact: small.matches, memory: n.deviceMemory, cores: n.hardwareConcurrency, saveData: n.connection?.saveData
      });
      setAllowed(!policy.fallback);
      setCompact(policy.compact);
      setReason(policy.fallback || "ready");
      if (policy.fallback)
        setReady(false);
    };
    evaluate();
    motion.addEventListener("change", evaluate);
    small.addEventListener("change", evaluate);
    return () => {
      motion.removeEventListener("change", evaluate);
      small.removeEventListener("change", evaluate);
    };
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node)
      return;
    const visibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    visibility();
    const preload = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNear(true);
        preload.disconnect();
      }
    }, { rootMargin: "160px" });
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    preload.observe(node);
    observer.observe(node);
    return () => {
      preload.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (!active)
      return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Content, not a synthetic scroll runway, determines the camera milestones.
      const focus = window.innerHeight * .5;
      const points = anchors.flatMap(([id, progress]) => {
        const element = document.getElementById(id);
        return element ? [{ top: element.getBoundingClientRect().top - focus, progress }] : [];
      });
      if (!points.length) return;
      let p = points[0].progress;
      for (let i = 0; i < points.length; i++) {
        if (points[i].top > 0) break;
        p = points[i].progress;
        const next = points[i + 1];
        if (next && next.top > 0) {
          const t = -points[i].top / Math.max(1, next.top - points[i].top);
          p += (next.progress - p) * t;
          break;
        }
      }
      const measuredProgress = Math.max(0, Math.min(1, p));
      setProgress(measuredProgress);
      const height = window.innerHeight;
      const finish = document.getElementById("home-finish");
      const followFinal = compact && window.innerWidth / height < 1.15 && measuredProgress >= .94 && finish;
      setFinalShift(followFinal
        ? (Math.min(0, finish.getBoundingClientRect().top)
          - Math.min(0, visualRef.current?.getBoundingClientRect().top ?? 0)) / height
        : 0);
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    const root = document.getElementById("home-connected-journey");
    if (root)
      observer.observe(root);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [active, compact]);
  return <figure
    ref={ref}
    className={styles.journey}
    style={{ "--journey-final-shift": `${interactive && ready ? finalShift * 100 : 0}svh` } as CSSProperties}
    data-home-journey
    aria-describedby="home-journey-description"
    data-journey-layout="environment"
    data-mode={interactive && ready ? "interactive" : "static"}
    data-reason={staticView ? "user-static" : failed ? "rendering-unavailable" : reason}
    data-active={active}
    data-progress={progress.toFixed(4)}
    data-final-shift={finalShift.toFixed(5)}
    data-quality={compact ? "compact" : "full"}
  >
    <div ref={visualRef} className={styles.visual} aria-hidden="true">
      <div className={`${styles.poster} ${interactive && ready ? styles.hidden : ""}`}>
        <Poster />
      </div>
      {near && interactive ? <div className={`${styles.canvas} ${ready ? styles.ready : ""}`} data-spatial-webgl>
        <Boundary onFailure={onFailure}>
          <Scene
            progress={progress}
            active={active}
            compact={compact}
            finalShift={finalShift}
            onReady={onReady}
            onFailure={onFailure}
          />
        </Boundary>
      </div> : null}
      <div className={styles.vignette} />
    </div>
    <figcaption className={styles.caption}>
      <span className={styles.label}>Drug Discovery <small>Vaeroex sculpture</small>
      </span>
      <span id="home-journey-description" className="sr-only">The Vaeroex VX symbol in 3D. Its two capped arms meet around a diamond-shaped opening.</span>
      <nav aria-label="Explore Vaeroex offerings" className={styles.offerings}>
        <a href="/drug-discovery-intelligence#compound-explorer">Compounds</a>
        <a href="/drug-discovery-intelligence#evidence">Evidence</a>
        <a href="/drug-discovery-intelligence#approval">Shortlist</a>
      </nav>
      {allowed && !failed ? <button
        type="button"
        aria-pressed={staticView}
        onClick={() => {
          setStaticView(v => !v);
          setReady(false);
        }}
      >{staticView ? "Enable motion" : "Static view"}</button> : <span className={styles.static}>Static view</span>}
    </figcaption>
  </figure>;
}
