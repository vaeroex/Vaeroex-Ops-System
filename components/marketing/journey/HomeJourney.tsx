"use client";
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clarityDevicePolicy } from "../clarity/clarityDevicePolicy";
import styles from "./HomeJourney.module.css";
const Scene = dynamic(() => import("./JourneyCanvas"), { ssr: false });
const anchors = ["solutions", "featured-product", "home-custom", "home-websites", "home-finish"];
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
  return <svg viewBox="0 0 1200 320" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="journey-metal" x2="1" y2="1">
        <stop stopColor="#6382ac" />
        <stop offset=".45" stopColor="#15243a" />
        <stop offset="1" stopColor="#30436a" />
      </linearGradient>
    </defs>
    {[0, 1, 2, 3, 4, 5, 6].map(i => <g key={i} transform={`translate(600 150) scale(${1 - i * .115})`}>
      <path
        d="M-400-170H400V170H-400Z M-365-135V135H365V-135Z"
        fill="url(#journey-metal)"
        fillRule="evenodd"
        stroke="#829bcc"
        strokeWidth="2"
      />
      <path
        d="M-365-135H365M-365 135H365"
        stroke={i % 3 === 0 ? '#a5baff' : i % 3 === 1 ? '#8cd5c4' : '#c5b2ed'}
        strokeWidth="3"
      />
    </g>)}
    {[-1, 1].map(s => <g key={s} stroke="#86b1f0" opacity=".7">
      <path d={`M${600 + s * 600} 320L600 150M${600 + s * 600} 0L600 150`} />
      <path d={`M${600 + s * 600} 240L600 150`} />
    </g>)}
    <path d="M564 143h72v14h-72z" fill="#b9cdff" />
  </svg>;
}
export function HomeJourney() {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false), [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true), [compact, setCompact] = useState(false);
  const [allowed, setAllowed] = useState(false), [failed, setFailed] = useState(false);
  const [staticView, setStaticView] = useState(false), [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0), [reason, setReason] = useState("loading");
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
      const focus = (ref.current?.getBoundingClientRect().bottom ?? 0) + 80;
      const points = anchors.map(id => (document.getElementById(id)?.getBoundingClientRect().top ?? 0) - focus);
      let p = points[4] <= 0 ? 1 : 0;
      for (let i = 0; i < 4; i++)
        if (points[i] <= 0 && points[i + 1] > 0) {
          p = (i - points[i] / Math.max(1, points[i + 1] - points[i])) / 4;
          break;
        }
      setProgress(p);
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
  }, [active]);
  return <figure
    ref={ref}
    className={styles.journey}
    data-home-journey
    data-mode={interactive && ready ? "interactive" : "static"}
    data-reason={staticView ? "user-static" : failed ? "rendering-unavailable" : reason}
    data-active={active}
    data-progress={progress.toFixed(4)}
    data-quality={compact ? "compact" : "full"}
  >
    <div className={styles.visual} aria-hidden="true">
      <div className={`${styles.poster} ${interactive && ready ? styles.hidden : ""}`}>
        <Poster />
      </div>
      {near && interactive ? <div className={`${styles.canvas} ${ready ? styles.ready : ""}`} data-spatial-webgl>
        <Boundary onFailure={onFailure}>
          <Scene
            progress={progress}
            active={active}
            compact={compact}
            onReady={onReady}
            onFailure={onFailure}
          />
        </Boundary>
      </div> : null}
      <div className={styles.vignette} />
    </div>
    <figcaption className={styles.caption}>
      <span className={styles.label}>Connected by design <small>Conceptual view</small>
      </span>
      <nav aria-label="Explore Vaeroex offerings" className={styles.offerings}>
        <a href="/intelligence-systems">Intelligence</a>
        <a href="/custom-business-systems">Software</a>
        <a href="/website-development">Websites</a>
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
