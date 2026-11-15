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
  // A cutaway overview of the same fictional operations-center concept as the
  // 3D world. The floor connects every zone; front walls are omitted for clarity.
  const point = (x: number, z: number, height = 0) =>
    `${600 + (x - z) * 45},${430 + (x + z) * 22 - height * 55}`;
  const plane = (...vertices: [number, number, number][]) =>
    vertices.map(([x, z, height]) => point(x, z, height)).join(" ");
  const block = (x: number, z: number, width: number, depth: number, height: number, tone: string, key: string) => (
    <g key={key} stroke="#58708b" strokeWidth="1.3" strokeLinejoin="round">
      <polygon points={plane([x,z,height],[x+width,z,height],[x+width,z+depth,height],[x,z+depth,height])} fill={tone} />
      <polygon points={plane([x,z+depth,0],[x,z+depth,height],[x+width,z+depth,height],[x+width,z+depth,0])} fill="#172b3c" />
      <polygon points={plane([x+width,z,0],[x+width,z,height],[x+width,z+depth,height],[x+width,z+depth,0])} fill="#101e2d" />
    </g>
  );
  return <svg viewBox="0 0 1200 800" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="journey-horizon" cx=".6" cy=".45" r=".7">
        <stop stopColor="#263a50" />
        <stop offset="1" stopColor="#080d16" />
      </radialGradient>
      <linearGradient id="journey-floor" x2=".3" y2="1">
        <stop stopColor="#273b4c" />
        <stop offset="1" stopColor="#101d2c" />
      </linearGradient>
      <linearGradient id="journey-screen" x2="1" y2="1">
        <stop stopColor="#426b91" />
        <stop offset="1" stopColor="#152639" />
      </linearGradient>
    </defs>
    <path fill="url(#journey-horizon)" d="M0 0h1200v800H0z" />
    <ellipse cx="620" cy="530" rx="495" ry="210" fill="#03070c" opacity=".55" />
    {/* One continuous floor slab, with visible thickness on the cutaway edges. */}
    <polygon points={plane([-6,-5,0],[6,-5,0],[6,5,0],[-6,5,0])} fill="url(#journey-floor)" stroke="#8095ac" strokeWidth="2" />
    <polygon points={plane([-6,5,0],[6,5,0],[6,5,-.25],[-6,5,-.25])} fill="#182534" stroke="#52677e" />
    <polygon points={plane([6,-5,0],[6,5,0],[6,5,-.25],[6,-5,-.25])} fill="#0d1725" stroke="#52677e" />
    <g stroke="#6b849a" opacity=".18">
      {[-4,-2,0,2,4].map(value => <g key={value}>
        <path d={`M${point(value,-5)}L${point(value,5)}`} />
        <path d={`M${point(-6,value)}L${point(6,value)}`} />
      </g>)}
    </g>
    {/* Rear and side walls include genuine openings and continuous lintels. */}
    <g fill="#253849" stroke="#6f869c" strokeWidth="1.5" strokeLinejoin="round">
      <polygon points={plane([-6,-5,0],[-6,-5,3],[-1,-5,3],[-1,-5,0])} />
      <polygon points={plane([1,-5,0],[1,-5,3],[6,-5,3],[6,-5,0])} />
      <polygon points={plane([-1,-5,2.2],[-1,-5,3],[1,-5,3],[1,-5,2.2])} />
      <polygon points={plane([-6,-5,0],[-6,-5,3],[-6,-1,3],[-6,-1,0])} fill="#1b2c3c" />
      <polygon points={plane([-6,1,0],[-6,1,3],[-6,5,3],[-6,5,0])} fill="#1b2c3c" />
      <polygon points={plane([-6,-1,2.2],[-6,-1,3],[-6,1,3],[-6,1,2.2])} fill="#1b2c3c" />
    </g>
    <g stroke="#adc8e0" strokeWidth="3" opacity=".75">
      <path d={`M${point(-6,-5,2.9)}L${point(6,-5,2.9)}`} />
      <path d={`M${point(-6,-5,2.9)}L${point(-6,5,2.9)}`} />
    </g>
    <g strokeWidth="2" strokeLinejoin="round">
      <path d={`M${point(-5,0,.02)}L${point(-1,0,.02)}L${point(-1,2.3,.02)}L${point(4.8,2.3,.02)}`} stroke="#94b8e8" />
      <path d={`M${point(-1,0,.02)}L${point(1,0,.02)}L${point(1,-3,.02)}L${point(5,-3,.02)}`} stroke="#9ed8cc" />
      <path d={`M${point(-1,2.3,.02)}L${point(-1,4.2,.02)}L${point(-4.5,4.2,.02)}`} stroke="#c5b2e4" />
    </g>
    {/* Central intelligence core and wall displays: light and structure, no data. */}
    {block(-3.8,-3.7,2,1.6,.3,"#4e657d","core-base")}
    {block(-3.5,-3.4,1.4,1.05,2.2,"#6886a6","core")}
    {[.4,.8,1.2,1.6,2].map(height => <path key={height} d={`M${point(-3.35,-2.34,height)}L${point(-2.25,-2.34,height)}`} stroke="#b6d8ff" strokeWidth="3" />)}
    {[1.7,3.1,4.5].map(x => <g key={x}>
      <polygon points={plane([x,-4.96,1.05],[x,-4.96,2.2],[x+1.1,-4.96,2.2],[x+1.1,-4.96,1.05])} fill="#0c1826" stroke="#98b4cc" strokeWidth="2" />
      <polygon points={plane([x+.08,-4.95,1.15],[x+.08,-4.95,2.1],[x+1.02,-4.95,2.1],[x+1.02,-4.95,1.15])} fill="url(#journey-screen)" />
    </g>)}
    {/* Connected workstations with desks, upright monitors, and seats. */}
    {[[-.2,-1.7],[2.8,-1.7],[.5,.7],[3.5,.7]].map(([x,z],index) => <g key={index}>
      {block(x,z,1.8,.9,.82,"#5a7388",`desk-${index}`)}
      <polygon points={plane([x+.22,z+.14,.86],[x+.22,z+.14,1.6],[x+1.58,z+.14,1.6],[x+1.58,z+.14,.86])} fill="url(#journey-screen)" stroke="#a4d2ce" strokeWidth="2" />
      <path d={`M${point(x+.9,z+.16,.86)}L${point(x+.9,z+.48,.84)}`} stroke="#9bb3c5" strokeWidth="3" />
      {block(x+.55,z+1.1,.7,.6,.47,"#324e61",`seat-${index}`)}
    </g>)}
    {/* Dimensional browser gallery: abstract page composition, never product UI. */}
    {[-4.5,-2.25,0].map((x,index) => <g key={x}>
      {block(x-.12,3.15,1.8,.55,.18,"#4b5773",`gallery-base-${index}`)}
      <polygon points={plane([x,3.3,.2],[x,3.3,2.65],[x+1.55,3.3,2.65],[x+1.55,3.3,.2])} fill="#172338" stroke="#c0aedb" strokeWidth="2" />
      <polygon points={plane([x+1.55,3.3,.2],[x+1.55,3.3,2.65],[x+1.55,3.08,2.65],[x+1.55,3.08,.2])} fill="#35445f" stroke="#9d96b7" />
      <polygon points={plane([x,3.3,2.34],[x,3.3,2.65],[x+1.55,3.3,2.65],[x+1.55,3.3,2.34])} fill="#52627b" />
      {[.16,.31,.46].map(dot => { const [cx,cy]=point(x+dot,3.31,2.5).split(','); return <circle key={dot} cx={cx} cy={cy} r="1.8" fill="#d6c6e7" />; })}
      <polygon points={plane([x+.12,3.31,1.22],[x+.12,3.31,2.15],[x+1.42,3.31,2.15],[x+1.42,3.31,1.22])} fill="url(#journey-screen)" />
      {[.55,.8].map(height => <path key={height} d={`M${point(x+.15,3.31,height)}L${point(x+1.25,3.31,height)}`} stroke="#a89fc0" strokeWidth="3" />)}
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
      <span className={styles.label}>Connected by design <small>Illustrative environment</small>
      </span>
      <span id="home-journey-description" className="sr-only">Fictional architectural visualization, not a depiction of actual Vaeroex facilities or product interfaces.</span>
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
