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
  // The same authored V-fold and offset wing as the 3D sculpture, projected
  // obliquely so the depth, inset material layers, and narrow seam remain legible.
  type Point = [number, number];
  const project = ([x, y]: Point, depth: number) =>
    `${650 + x * 15.3 + depth * 5.1},${420 - y * 16 + depth * 1.76}`;
  const outline = (a: Point, b: Point, width: number): Point[] => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
    const half = width / 2, bevel = .24;
    const at = (point: Point, along: number, across: number): Point =>
      [point[0] + ux * along - uy * across, point[1] + uy * along + ux * across];
    return [at(a,0,half-bevel), at(a,bevel,half), at(b,-bevel,half), at(b,0,half-bevel),
      at(b,0,-half+bevel), at(b,-bevel,-half), at(a,bevel,-half), at(a,0,-half+bevel)];
  };
  const points = (vertices: Point[], depth: number) => vertices.map(point => project(point,depth)).join(" ");
  const folds: {a: Point; b: Point; width: number}[] = [
    {a:[-14,18], b:[-1,-9], width:4.5},
    {a:[-1,-9], b:[5,1], width:4},
    {a:[5,1], b:[15,-12], width:4.2},
    {a:[13,3], b:[20,12], width:4},
  ];
  const seam = [[-13,16],[-1,-8],[5,1],[14,-10.7]] as Point[];
  const seamPath = (depth: number) => seam.map((point,index) => `${index ? "L" : "M"}${project(point,depth)}`).join(" ");
  return <svg viewBox="0 0 1200 800" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <defs>
      <radialGradient id="journey-horizon" cx=".6" cy=".42" r=".7">
        <stop stopColor="#253446" />
        <stop offset="1" stopColor="#080d16" />
      </radialGradient>
      <linearGradient id="journey-graphite" x1="390" y1="90" x2="880" y2="680" gradientUnits="userSpaceOnUse">
        <stop stopColor="#9aa8b5" />
        <stop offset=".24" stopColor="#394958" />
        <stop offset=".6" stopColor="#1c2835" />
        <stop offset="1" stopColor="#526577" />
      </linearGradient>
      <linearGradient id="journey-edge" x1="250" y1="250" x2="950" y2="620" gradientUnits="userSpaceOnUse">
        <stop stopColor="#182230" />
        <stop offset=".55" stopColor="#0d1520" />
        <stop offset="1" stopColor="#324559" />
      </linearGradient>
      <linearGradient id="journey-metal" x1="440" y1="100" x2="880" y2="660" gradientUnits="userSpaceOnUse">
        <stop stopColor="#d1dbe2" />
        <stop offset=".3" stopColor="#6d8192" />
        <stop offset=".7" stopColor="#b4c2cc" />
        <stop offset="1" stopColor="#42566a" />
      </linearGradient>
      <linearGradient id="journey-glass" x1="470" y1="180" x2="910" y2="620" gradientUnits="userSpaceOnUse">
        <stop stopColor="#b6d9df" stopOpacity=".5" />
        <stop offset=".45" stopColor="#6b97ac" stopOpacity=".12" />
        <stop offset="1" stopColor="#d0c6e7" stopOpacity=".4" />
      </linearGradient>
    </defs>
    <path fill="url(#journey-horizon)" d="M0 0h1200v800H0z" />
    <ellipse cx="665" cy="696" rx="350" ry="34" fill="#03070d" opacity=".55" />
    {/* Deep chamfered blades form one composed sculpture, without a built environment. */}
    {folds.map(({a,b,width},index) => {
      const vertices = outline(a,b,width);
      return <g key={index} strokeLinejoin="round">
        <polygon points={points(vertices,-33)} fill="#182432" stroke="#4c5d6d" strokeWidth="1" />
        {vertices.map((vertex,edge) => {
          const next = vertices[(edge+1)%vertices.length];
          return <polygon key={edge} points={`${project(vertex,-33)} ${project(next,-33)} ${project(next,1)} ${project(vertex,1)}`}
            fill="url(#journey-edge)" stroke="#3c4d5e" strokeWidth=".8" />;
        })}
        <polygon points={points(vertices,1)} fill="url(#journey-graphite)" stroke="#a1b4c5" strokeWidth="1.2" />
        <polygon points={points(outline(a,b,width*.53),1.08)} fill="url(#journey-metal)" opacity=".72" />
        <polygon points={points(outline(a,b,width*.36),1.16)} fill="url(#journey-glass)" stroke="#a9c8d3" strokeOpacity=".45" strokeWidth=".65" />
      </g>;
    })}
    {/* The dark joint and restrained light trace reveal connected inset layers. */}
    <path d={seamPath(1.22)} stroke="#08111d" strokeWidth="7" strokeLinejoin="bevel" />
    <path d={seamPath(1.24)} stroke="#658da7" strokeWidth="3.5" strokeLinejoin="bevel" />
    <path d={seamPath(1.28)} stroke="#cae5ed" strokeWidth="1.15" strokeLinejoin="bevel" />
    <path d={`M${project([13.5,3.7],1.22)}L${project([19.5,11.3],1.22)}`} stroke="#b7d5e5" strokeWidth="1.3" />
    <path d={`M${project([-1,-8],1.1)}L${project([-1,-8],-5)}L${project([5,1],-5)}`} stroke="#97bfb8" strokeOpacity=".7" strokeWidth="1.2" />
    <path d={`M${project([5,1],1.1)}L${project([5,1],-9)}L${project([14,-10.7],-9)}`} stroke="#b5aad0" strokeOpacity=".6" strokeWidth="1.2" />
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
    aria-describedby="home-journey-description"
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
      <span className={styles.label}>Connected by design <small>Illustrative sculpture</small>
      </span>
      <span id="home-journey-description" className="sr-only">An illustrative sculpture inspired by the Vaeroex mark, with folded graphite, metal, glass, and connected inset layers.</span>
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
