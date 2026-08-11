"use client";

import { ArrowLeft, ArrowRight, Maximize2, Minimize2, MoveHorizontal } from "lucide-react";
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

type ViewportGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  axis: "horizontal" | "vertical" | null;
};

export function IntelligenceUniverseShell() {
  const universe = useIntelligenceUniverse();
  const viewportGesture = useRef<ViewportGesture | null>(null);
  const selectedSystem = systemById.get(universe.state.selectedSystem) || PUBLIC_SYSTEMS[0];
  const productRoute = isUniverseSystemDestination(universe.state.current);

  useEffect(() => {
    if (!universe.shellVisible || universe.state.inputLocked) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      viewportGesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null
      };
      universe.beginRailDrag(event.clientX, performance.now());
    };

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const gesture = viewportGesture.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const horizontalDistance = Math.abs(event.clientX - gesture.startX);
      const verticalDistance = Math.abs(event.clientY - gesture.startY);
      if (!gesture.axis && Math.max(horizontalDistance, verticalDistance) > 5) {
        gesture.axis = horizontalDistance > verticalDistance * 1.15 ? "horizontal" : "vertical";
      }
      if (gesture.axis !== "horizontal") return;
      event.preventDefault();
      universe.updateRailDrag(event.clientX, performance.now(), window.innerWidth);
    };

    const finishPointer = (event: globalThis.PointerEvent) => {
      const gesture = viewportGesture.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      viewportGesture.current = null;
      universe.endRailDrag(performance.now());
    };

    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.72;
      if (!horizontalIntent || Math.abs(event.deltaX) < 2) return;
      event.preventDefault();
      universe.moveRailBy(event.deltaX * 0.0018);
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", finishPointer, true);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", finishPointer, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [universe]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      universe.selectAdjacentSystem(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      universe.selectAdjacentSystem(1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      universe.enterSelectedSystem();
    } else if (event.key === "Escape") {
      event.preventDefault();
      universe.travel("intelligence-systems");
    }
  };

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
          <div className={styles.interaction} data-universe-interaction>
            <div className={styles.viewportHint} aria-hidden="true">
              <MoveHorizontal />
              <span>Drag the environment to explore</span>
            </div>

            <div className={styles.selectionReadout} aria-live="polite">
              <p>{selectedSystem.statusLabel}</p>
              <strong>{selectedSystem.name}</strong>
              <span>{selectedSystem.tagline}</span>
            </div>

            <div
              className={styles.navigationPanel}
              data-universe-control
              tabIndex={0}
              role="group"
              aria-label="Intelligence Universe navigation"
              onKeyDown={onKeyDown}
            >
              <div className={styles.systemRail} aria-label="Choose an Intelligence System">
                <button type="button" onClick={() => universe.selectAdjacentSystem(-1)} aria-label="Previous Intelligence System">
                  <ArrowLeft aria-hidden="true" />
                </button>
                <nav>
                  {PUBLIC_SYSTEMS.map((system) => {
                    const destination = system.id as IntelligenceUniverseSystemDestination;
                    return (
                      <UniverseNavigationLink
                        key={system.id}
                        href={system.route}
                        data-current={universe.state.selectedSystem === destination}
                        aria-current={universe.state.selectedSystem === destination ? "true" : undefined}
                      >
                        {system.name.replace(" Intelligence", "")}
                      </UniverseNavigationLink>
                    );
                  })}
                </nav>
                <button type="button" onClick={() => universe.selectAdjacentSystem(1)} aria-label="Next Intelligence System">
                  <ArrowRight aria-hidden="true" />
                </button>
              </div>

              <UniverseNavigationLink className={styles.enterLink} href={selectedSystem.route}>
                Enter {selectedSystem.name}
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
          Back to Intelligence Universe
        </UniverseNavigationLink>
      ) : null}
    </>
  );
}
