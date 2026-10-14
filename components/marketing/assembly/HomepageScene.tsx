"use client";
import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { clarityDevicePolicy } from "../clarity/clarityDevicePolicy";
import { ASSEMBLY_STAGES, clamp } from "./assemblyMotion";
import styles from "./HomepageScene.module.css";
const Scene = dynamic(() => import("./AssemblyCanvas"), { ssr: false });
class Boundary extends Component<
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
const anchors = [
  "home-title",
  "product-title",
  "business-context",
  "trust-title",
  "closing-title",
];
function Poster() {
  return (
    <svg viewBox="0 0 600 700" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="assembly-metal" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#718bb5" />
          <stop offset=".5" stopColor="#17283f" />
          <stop offset="1" stopColor="#4667ac" />
        </linearGradient>
      </defs>
      {Array.from({ length: 8 }, (_, j) => (
        <g key={j} transform={`translate(300 ${160 + j * 48})`}>
          <path
            d="M-130 0 0-54 130 0 0 54Z"
            fill="url(#assembly-metal)"
            stroke="#8ba9dd"
          />
          <path
            d="M-130 0v20L0 74l130-54V0L0 54Z"
            fill="#13223a"
            stroke="#587bb8"
          />
          {Array.from({ length: 5 }, (_, i) => (
            <path
              key={i}
              d={`M${-65 + i * 13} ${-8 + i * 5}l45-18 35 14-45 18Z`}
              stroke="#9db9e2"
              opacity=".6"
            />
          ))}
        </g>
      ))}
      <path
        d="M170 160v356M430 160v356M300 106v356"
        stroke="#a0c4ff"
        strokeWidth="2"
      />
    </svg>
  );
}
export function HomepageScene() {
  const element = useRef<HTMLDivElement>(null),
    [interactive, setInteractive] = useState(false),
    [compact, setCompact] = useState(false),
    [ready, setReady] = useState(false),
    [paused, setPaused] = useState(false),
    [active, setActive] = useState(true),
    [progress, setProgress] = useState(0);
  const onReady = useCallback(() => setReady(true), []),
    onFailure = useCallback(() => {
      setInteractive(false);
      setReady(false);
    }, []);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)"),
      small = matchMedia("(max-width: 760px)");
    const evaluate = () => {
      const n = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean };
      };
      const policy = clarityDevicePolicy({
        reducedMotion: motion.matches,
        compact: small.matches,
        saveData: n.connection?.saveData,
        memory: n.deviceMemory,
        cores: n.hardwareConcurrency,
      });
      setCompact(policy.compact);
      setInteractive(!policy.fallback);
      if (policy.fallback) setReady(false);
    };
    const idle = window.setTimeout(evaluate, 250);
    motion.addEventListener("change", evaluate);
    small.addEventListener("change", evaluate);
    return () => {
      clearTimeout(idle);
      motion.removeEventListener("change", evaluate);
      small.removeEventListener("change", evaluate);
    };
  }, []);
  useEffect(() => {
    const root = document.getElementById("home-information-journey");
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const visible =
        bounds.bottom > 100 &&
        bounds.top < innerHeight &&
        document.visibilityState === "visible";
      setActive(visible);
      if (element.current) element.current.dataset.visible = String(visible);
      if (paused || !visible) return;
      const focus =
        innerWidth <= 760
          ? 70 + innerHeight * 0.28 + (innerHeight * 0.72 - 70) * 0.3
          : innerHeight * 0.34;
      const centers = anchors.map((id) => {
        const node = document.getElementById(id);
        return (node?.getBoundingClientRect().top ?? 0) - focus;
      });
      let p = centers[4] <= 0 ? 1 : 0;
      for (let i = 0; i < 4; i++)
        if (centers[i] <= 0 && centers[i + 1] > 0) {
          p =
            (i +
              clamp(-centers[i] / Math.max(1, centers[i + 1] - centers[i]))) /
            4;
          break;
        }
      setProgress(p);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [paused]);
  const stage = Math.min(4, Math.round(progress * 4));
  const ease = (v: number) => {
    const t = clamp(v);
    return t * t * (3 - 2 * t);
  };
  const shift = ease((progress - 0.3) / 0.13) * ease((0.72 - progress) / 0.13);
  return (
    <div
      ref={element}
      className={styles.scene}
      style={{ "--assembly-shift": shift } as CSSProperties}
      data-home-assembly
      data-stage={stage}
      data-progress={progress.toFixed(4)}
      data-mode={interactive && ready ? "interactive" : "static"}
      data-active={active && !paused}
      data-visible="true"
    >
      <div
        className={`${styles.poster} ${ready ? styles.hidden : ""}`}
        data-assembly-poster
      >
        <Poster />
      </div>
      {interactive ? (
        <div
          className={`${styles.canvas} ${ready ? styles.ready : ""}`}
          aria-hidden="true"
          data-spatial-webgl
        >
          <Boundary onFailure={onFailure}>
            <Scene
              progress={progress}
              active={active && !paused}
              compact={compact}
              onReady={onReady}
              onFailure={onFailure}
            />
          </Boundary>
        </div>
      ) : null}
      <div className={styles.controls}>
        <span>
          0{stage + 1} / {ASSEMBLY_STAGES[stage]}
          <small>INFORMATION → UNDERSTANDING · CONCEPTUAL</small>
        </span>
        {interactive && ready ? (
          <button
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={
              paused
                ? "Resume information journey"
                : "Pause information journey"
            }
          >
            {paused ? "Resume" : "Pause"}
          </button>
        ) : (
          <span className={styles.staticLabel}>CONCEPT RENDER</span>
        )}
      </div>
      <nav
        className={styles.chapters}
        aria-label="Information journey chapters"
      >
        {ASSEMBLY_STAGES.map((label, i) => (
          <a
            key={label}
            href={`#${anchors[i]}`}
            aria-current={i === stage ? "step" : undefined}
            aria-label={`${i + 1}. ${label}`}
          >
            <span>0{i + 1}</span>
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
