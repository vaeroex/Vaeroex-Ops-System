"use client";

import { ArrowRight, ChevronsDown, LocateFixed, Maximize2, Minimize2 } from "lucide-react";
import type { CSSProperties } from "react";
import { IntelligenceUniverseBackdrop } from "@/components/marketing/intelligence-universe/IntelligenceUniverseBackdrop";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";
import { UniverseNavigationLink } from "@/components/marketing/intelligence-universe/UniverseNavigationLink";
import {
  INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS,
  INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS,
  INTELLIGENCE_UNIVERSE_MAP_EXTENTS,
  INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS,
  INTELLIGENCE_UNIVERSE_ROUTES,
  INTELLIGENCE_UNIVERSE_SYSTEMS,
  isUniverseSystemDestination,
  type IntelligenceUniverseDestination
} from "@/lib/marketing/intelligence-universe";
import styles from "@/components/marketing/intelligence-universe/intelligence-universe.module.css";

function orientationStyle(destination: IntelligenceUniverseDestination): CSSProperties {
  const position = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[destination];
  const x = (position.x - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[0])
    / (INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[1] - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[0]);
  const y = 1 - (position.y - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[0])
    / (INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[1] - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[0]);
  return { left: `${(x * 88 + 6).toFixed(2)}%`, top: `${(y * 78 + 11).toFixed(2)}%` };
}

export function IntelligenceUniverseShell() {
  const universe = useIntelligenceUniverse();
  const selectedDefinition = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[universe.state.selectedDestination];
  const productRoute = isUniverseSystemDestination(universe.state.current);

  return (
    <>
      {universe.shellVisible ? (
        <div className={styles.visual} data-active="true" data-intelligence-universe-shell aria-hidden="true">
          <IntelligenceUniverseBackdrop />
        </div>
      ) : null}

      {universe.shellVisible ? (
        <>
          <div className={styles.transitionVeil} data-phase={universe.state.phase} aria-hidden="true" />
          <div
            className={styles.interaction}
            data-universe-interaction
            data-universe-guided
            data-visible={universe.controlsVisible}
          >
            <div className={styles.viewportHint} aria-hidden="true">
              <ChevronsDown />
              <span>Scroll to move through Vaeroex</span>
            </div>

            <aside className={styles.orientationAid} aria-label="Vaeroex Intelligence Universe orientation">
              <div className={styles.orientationHeading}>
                <LocateFixed aria-hidden="true" />
                <span>VAEROEX / UNIVERSE</span>
              </div>
              <div className={styles.orientationPlot} aria-hidden="true">
                <i className={styles.orientationTrace} />
                {[...INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS, ...INTELLIGENCE_UNIVERSE_SYSTEMS].map((destination) => (
                  <span
                    key={destination}
                    className={styles.orientationMarker}
                    data-kind={INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[destination].kind}
                    style={orientationStyle(destination)}
                  >
                    {INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[destination].code.split(" /")[0]}
                  </span>
                ))}
                <b className={styles.orientationPosition} />
              </div>
              <span className={styles.depthReadout}>One guided public environment</span>
            </aside>

            <div className={styles.selectionReadout} data-proximity={universe.state.proximity} aria-live="polite">
              <p>{selectedDefinition.statusLabel}</p>
              <strong>{selectedDefinition.name}</strong>
              <span>{selectedDefinition.description}</span>
            </div>

            <div className={styles.navigationPanel} data-universe-control>
              <div className={styles.destinationGroups}>
                <nav className={styles.destinationIndex} aria-label="Navigate to public destinations">
                  {INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS.map((destination) => {
                    const definition = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[destination];
                    return (
                      <UniverseNavigationLink
                        key={destination}
                        href={definition.route}
                        data-current={universe.state.selectedDestination === destination}
                        aria-current={universe.state.current === destination ? "page" : undefined}
                      >
                        <small>{definition.code.split(" /")[0]}</small>
                        <span>{definition.shortName}</span>
                      </UniverseNavigationLink>
                    );
                  })}
                </nav>
                <nav className={styles.systemIndex} aria-label="Intelligence Systems destinations">
                  <small>Intelligence Systems</small>
                  {INTELLIGENCE_UNIVERSE_SYSTEMS.map((destination) => {
                    const definition = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[destination];
                    return (
                      <UniverseNavigationLink
                        key={destination}
                        href={definition.route}
                        data-current={universe.state.selectedDestination === destination}
                        aria-current={universe.state.current === destination ? "page" : undefined}
                      >
                        {definition.shortName}
                      </UniverseNavigationLink>
                    );
                  })}
                </nav>
              </div>

              <UniverseNavigationLink className={styles.enterLink} href={selectedDefinition.route}>
                Explore {selectedDefinition.name}
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
        <UniverseNavigationLink className={styles.returnControl} data-universe-control href={INTELLIGENCE_UNIVERSE_ROUTES["intelligence-systems"]}>
          <Minimize2 aria-hidden="true" />
          Return to Intelligence Universe
        </UniverseNavigationLink>
      ) : null}
    </>
  );
}
