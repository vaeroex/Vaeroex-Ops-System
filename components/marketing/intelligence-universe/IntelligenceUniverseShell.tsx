"use client";

import { ArrowLeft, ArrowRight, Maximize2, Minimize2 } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
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

export function IntelligenceUniverseShell() {
  const universe = useIntelligenceUniverse();
  const dragStart = useRef<{ x: number; time: number } | null>(null);
  const selectedSystem = systemById.get(universe.state.selectedSystem) || PUBLIC_SYSTEMS[0];
  const productRoute = isUniverseSystemDestination(universe.state.current);

  const completeGesture = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || universe.state.inputLocked) return;
    const distance = event.clientX - start.x;
    const elapsed = Math.max(1, performance.now() - start.time);
    const velocity = Math.abs(distance) / elapsed;
    if (Math.abs(distance) < 72 || velocity < 0.18) return;
    universe.selectAdjacentSystem(distance < 0 ? 1 : -1);
  };

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
          <div
            className={styles.interaction}
            data-universe-interaction
            tabIndex={0}
            role="group"
            aria-label="Intelligence Universe navigation"
            onKeyDown={onKeyDown}
            onPointerDown={(event) => {
              if (universe.state.inputLocked) return;
              dragStart.current = { x: event.clientX, time: performance.now() };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={completeGesture}
            onPointerCancel={() => { dragStart.current = null; }}
          >
            <div className={styles.selectionReadout} aria-live="polite">
              <p>{selectedSystem.statusLabel}</p>
              <strong>{selectedSystem.name}</strong>
              <span>{selectedSystem.tagline}</span>
            </div>

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
        </>
      ) : null}

      {universe.routeIsCompatible ? (
        <button
          type="button"
          className={styles.modeToggle}
          onClick={() => universe.setEnabled(!universe.enabled)}
          aria-pressed={universe.enabled}
          title={universe.enabled ? "Use classic page view" : "Use spatial view"}
        >
          {universe.enabled ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          <span>{universe.enabled ? "Classic view" : "Spatial view"}</span>
        </button>
      ) : null}

      {universe.enabled && productRoute && !universe.shellVisible ? (
        <UniverseNavigationLink className={styles.returnControl} href={INTELLIGENCE_UNIVERSE_ROUTES["intelligence-systems"]}>
          <Minimize2 aria-hidden="true" />
          Intelligence overview
        </UniverseNavigationLink>
      ) : null}
    </>
  );
}
