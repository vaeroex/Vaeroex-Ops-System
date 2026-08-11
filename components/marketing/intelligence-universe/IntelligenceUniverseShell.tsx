"use client";

import { ArrowRight, LocateFixed, Maximize2, Minimize2, Move3d } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { IntelligenceUniverseBackdrop } from "@/components/marketing/intelligence-universe/IntelligenceUniverseBackdrop";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";
import { UniverseNavigationLink } from "@/components/marketing/intelligence-universe/UniverseNavigationLink";
import {
  INTELLIGENCE_UNIVERSE_ROUTES,
  isUniverseSystemDestination,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import styles from "@/components/marketing/intelligence-universe/intelligence-universe.module.css";

const systemById = new Map(PUBLIC_SYSTEMS.map((system) => [system.id, system]));
const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, summary, [role='button'], [data-universe-control]";

type PointerPoint = {
  x: number;
  y: number;
};

function pointerDistance(points: PointerPoint[]) {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

export function IntelligenceUniverseShell() {
  const universe = useIntelligenceUniverse();
  const activePointers = useRef(new Map<number, PointerPoint>());
  const pinchDistance = useRef<number | null>(null);
  const selectedSystem = systemById.get(universe.state.selectedSystem) || PUBLIC_SYSTEMS[0];
  const productRoute = isUniverseSystemDestination(universe.state.current);
  const {
    beginExplorationDrag,
    endExplorationDrag,
    nudgeExploration,
    updateExplorationDrag
  } = universe;
  const inputLocked = universe.state.inputLocked;
  const shellVisible = universe.shellVisible;

  useEffect(() => {
    if (!shellVisible || inputLocked) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "touch" && event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...activePointers.current.values()];
      if (points.length === 1) {
        beginExplorationDrag(event.clientX, event.clientY, performance.now());
      } else if (points.length === 2) {
        endExplorationDrag(performance.now());
        pinchDistance.current = pointerDistance(points);
      }
    };

    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (!activePointers.current.has(event.pointerId)) return;
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...activePointers.current.values()];
      event.preventDefault();

      if (points.length >= 2) {
        const nextDistance = pointerDistance(points);
        if (pinchDistance.current !== null) {
          nudgeExploration({
            x: 0,
            y: 0,
            z: (pinchDistance.current - nextDistance) * 0.045
          });
        }
        pinchDistance.current = nextDistance;
        return;
      }

      updateExplorationDrag(
        event.clientX,
        event.clientY,
        performance.now(),
        window.innerWidth,
        window.innerHeight
      );
    };

    const finishPointer = (event: globalThis.PointerEvent) => {
      if (!activePointers.current.has(event.pointerId)) return;
      activePointers.current.delete(event.pointerId);
      const points = [...activePointers.current.values()];
      pinchDistance.current = null;
      if (points.length === 0) {
        endExplorationDrag(performance.now());
      } else if (points.length === 1) {
        beginExplorationDrag(points[0].x, points[0].y, performance.now());
      }
    };

    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
      const x = event.deltaX * unit * 0.023;
      const z = event.deltaY * unit * 0.027;
      if (Math.abs(x) < 0.01 && Math.abs(z) < 0.01) return;
      event.preventDefault();
      nudgeExploration({ x, y: 0, z });
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", finishPointer, true);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      activePointers.current.clear();
      pinchDistance.current = null;
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", finishPointer, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [
    beginExplorationDrag,
    endExplorationDrag,
    inputLocked,
    nudgeExploration,
    shellVisible,
    updateExplorationDrag
  ]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      universe.selectAdjacentSystem(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      universe.selectAdjacentSystem(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      universe.nudgeExploration({ x: 0, y: 0, z: -5 });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      universe.nudgeExploration({ x: 0, y: 0, z: 5 });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      universe.enterSelectedSystem();
    } else if (event.key === "Escape") {
      event.preventDefault();
      universe.travel("intelligence-systems");
    }
  };

  const openField = universe.state.proximity === "open_field";

  return (
    <>
      {universe.shellVisible ? (
        <div
          className={styles.visual}
          data-active="true"
          data-intelligence-universe-shell
          aria-hidden="true"
        >
          <IntelligenceUniverseBackdrop />
        </div>
      ) : null}

      {universe.shellVisible ? (
        <>
          <div className={styles.transitionVeil} data-phase={universe.state.phase} aria-hidden="true" />
          <div className={styles.interaction} data-universe-interaction data-universe-free-roam>
            <div className={styles.viewportHint} aria-hidden="true">
              <Move3d />
              <span>Drag to roam · Scroll or pinch for depth</span>
            </div>

            <aside className={styles.orientationAid} aria-label="Intelligence Universe orientation">
              <div className={styles.orientationHeading}>
                <LocateFixed aria-hidden="true" />
                <span>VAEROEX / FIELD</span>
              </div>
              <div className={styles.orientationPlot} aria-hidden="true">
                <i className={styles.orientationTrace} />
                <span className={styles.orientationMarker} data-system="executive-intelligence">EI</span>
                <span className={styles.orientationMarker} data-system="drug-discovery-intelligence">DD</span>
                <span className={styles.orientationMarker} data-system="biological-intelligence">BI</span>
                <b className={styles.orientationPosition} />
              </div>
              <span className={styles.depthReadout}>Near / far position</span>
            </aside>

            <div className={styles.selectionReadout} data-proximity={universe.state.proximity} aria-live="polite">
              <p>{openField ? "Open intelligence field" : selectedSystem.statusLabel}</p>
              <strong>{openField ? "Between destinations" : selectedSystem.name}</strong>
              <span>{openField ? "Move freely, follow a distant signal, or use fast travel." : selectedSystem.tagline}</span>
            </div>

            <div
              className={styles.navigationPanel}
              data-universe-control
              tabIndex={0}
              role="group"
              aria-label="Intelligence Universe navigation"
              onKeyDown={onKeyDown}
            >
              <nav className={styles.destinationIndex} aria-label="Fast travel to an Intelligence System">
                {PUBLIC_SYSTEMS.map((system) => {
                  const destination = system.id as IntelligenceUniverseSystemDestination;
                  return (
                    <UniverseNavigationLink
                      key={system.id}
                      href={system.route}
                      data-current={universe.state.selectedSystem === destination && !openField}
                      aria-current={universe.state.selectedSystem === destination && !openField ? "true" : undefined}
                    >
                      <small>{system.id === "executive-intelligence" ? "01" : system.id === "drug-discovery-intelligence" ? "02" : "03"}</small>
                      <span>{system.name.replace(" Intelligence", "")}</span>
                    </UniverseNavigationLink>
                  );
                })}
              </nav>

              <UniverseNavigationLink className={styles.enterLink} href={selectedSystem.route}>
                Approach {selectedSystem.name}
                <ArrowRight aria-hidden="true" />
              </UniverseNavigationLink>
            </div>
          </div>
        </>
      ) : null}

      {universe.routeIsCompatible ? (
        <button
          type="button"
          className={styles.modeToggle}
          data-universe-control
          onClick={() => universe.setEnabled(!universe.enabled)}
          aria-pressed={universe.enabled}
          title={universe.enabled ? "Use classic page view" : "Use spatial view"}
        >
          {universe.enabled ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          <span>{universe.enabled ? "Classic view" : "Spatial view"}</span>
        </button>
      ) : null}

      {universe.enabled && productRoute && !universe.shellVisible ? (
        <UniverseNavigationLink
          className={styles.returnControl}
          data-universe-control
          href={INTELLIGENCE_UNIVERSE_ROUTES["intelligence-systems"]}
        >
          <Minimize2 aria-hidden="true" />
          Return to Intelligence Universe
        </UniverseNavigationLink>
      ) : null}
    </>
  );
}
