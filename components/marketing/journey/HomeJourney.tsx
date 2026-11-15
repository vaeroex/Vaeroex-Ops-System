"use client";
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clarityDevicePolicy } from "../clarity/clarityDevicePolicy";
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
  return <svg viewBox="0 0 1200 800" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="journey-metal" x2="1" y2="1">
        <stop stopColor="#6e8bb4" />
        <stop offset=".45" stopColor="#17253b" />
        <stop offset="1" stopColor="#304466" />
      </linearGradient>
      <radialGradient id="journey-horizon">
        <stop stopColor="#243653" />
        <stop offset="1" stopColor="#080d16" />
      </radialGradient>
    </defs>
    <path fill="url(#journey-horizon)" d="M0 0h1200v800H0z" />
    <g stroke="#475e7e" opacity=".28">
      {[0,1,2,3,4,5,6,7,8].map(i => <path key={i} d={`M${i*180-200} 800L640 240M0 ${360+i*65}H1200`} />)}
    </g>
    <g stroke="#8ba9e1" strokeWidth="2" opacity=".6">
      <path d="M300 760L610 540L840 430L760 300M360 800L660 570L890 450L800 300" />
      <path d="M610 540L420 440L560 350M840 430L1060 550L1140 490" />
    </g>
    {[
      {x:650,y:345,s:1.3,tone:'#a8bdff'},
      {x:350,y:490,s:1.5,tone:'#9cddcd'},
      {x:970,y:530,s:1.9,tone:'#d4bdef'},
    ].map(({x,y,s,tone},district) => <g key={x} transform={`translate(${x} ${y}) scale(${s}) skewY(-12)`}>
      {[0,1,2,3].map(i => <g key={i} transform={`translate(${i*20} ${i*-12})`}>
        <path d="M-74-106H70V34H-74Z M-65-97V25H61V-97Z" fill="url(#journey-metal)" fillRule="evenodd" stroke="#7188ab" />
        <path d="M-64 24H61M-64-97H61" stroke={tone} strokeWidth="2" />
      </g>)}
      {[0,1,2].map(i => <g key={i} transform={`translate(${i*38-30} ${i*4-60})`}>
        <path d="M0 0h25v40H0z" fill="#152238" stroke={tone} />
        <path d={district === 0 ? "M5 30v-8m5 8V15m5 15V8m5 22V4" : district === 1 ? "M5 10h15v20H5zM5 20h15" : "M4 8h17M4 16h17M4 22h10M4 28h14"} stroke={tone} />
      </g>)}
    </g>)}
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
      setProgress(Math.max(0, Math.min(1, p)));
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
    data-journey-layout="environment"
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
