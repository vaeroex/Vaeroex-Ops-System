"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useWorkspaceExperience } from "@/components/app/WorkspaceExperienceProvider";
import { SpatialErrorBoundary } from "@/components/spatial/SpatialErrorBoundary";
import { SpatialRoutePlane } from "@/components/spatial/SpatialRoutePlane";
import {
  isSpatialWorkspaceDestination,
  spatialDestinationDefinition,
  spatialDestinationForPathname,
  spatialTravelPlan,
  SPATIAL_NAVIGATION_INTENT_EVENT,
  type ActiveSpatialWorkspaceDestination,
  type SpatialNavigationIntentDetail,
  type SpatialTravelPlan
} from "@/components/spatial/spatial-destinations";
import { useSpatialCapability } from "@/components/spatial/useSpatialCapability";

const SpatialWorkspaceCanvas = dynamic(() => import("@/components/spatial/SpatialWorkspaceCanvas"), {
  ssr: false,
  loading: () => <div className="vaeroex-workspace-canvas-loading" aria-hidden="true" />
});

export function SpatialWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const destination = spatialDestinationForPathname(pathname);
  const capability = useSpatialCapability();
  const { experience, ready: experienceReady } = useWorkspaceExperience();
  const spatial = experienceReady
    && experience === "intel3d"
    && isSpatialWorkspaceDestination(destination)
    && capability.available;
  const [environmentReady, setEnvironmentReady] = useState(false);
  const [cameraDestination, setCameraDestination] = useState<ActiveSpatialWorkspaceDestination | null>(
    isSpatialWorkspaceDestination(destination) ? destination : null
  );
  const [motion, setMotion] = useState<"arriving" | "departing" | "settled">("arriving");
  const [travel, setTravel] = useState<SpatialTravelPlan | null>(null);
  const previousDestination = useRef<ActiveSpatialWorkspaceDestination | null>(null);
  const settleTimer = useRef<number | null>(null);
  const markEnvironmentReady = useCallback(() => setEnvironmentReady(true), []);

  useEffect(() => {
    if (!spatial) setEnvironmentReady(false);
  }, [spatial]);

  useEffect(() => {
    if (!spatial || !isSpatialWorkspaceDestination(destination)) {
      previousDestination.current = null;
      setCameraDestination(null);
      setMotion("settled");
      return;
    }

    const from = previousDestination.current || destination;
    const nextTravel = spatialTravelPlan(from, destination);
    setTravel(nextTravel);
    setCameraDestination(destination);
    setMotion(capability.quality === "reduced_motion" ? "settled" : "arriving");
    previousDestination.current = destination;

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    if (capability.quality !== "reduced_motion") {
      settleTimer.current = window.setTimeout(() => setMotion("settled"), nextTravel.durationMs);
    }

    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, [capability.quality, destination, spatial]);

  useEffect(() => {
    const handleNavigationIntent = (event: Event) => {
      if (!spatial || capability.quality === "reduced_motion" || !isSpatialWorkspaceDestination(destination)) return;
      const detail = (event as CustomEvent<SpatialNavigationIntentDetail>).detail;
      if (!detail || detail.from !== destination || detail.from === detail.to) return;
      const nextTravel = spatialTravelPlan(detail.from, detail.to);
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      setTravel(nextTravel);
      setCameraDestination(detail.to);
      setMotion("departing");
    };

    window.addEventListener(SPATIAL_NAVIGATION_INTENT_EVENT, handleNavigationIntent);
    return () => window.removeEventListener(SPATIAL_NAVIGATION_INTENT_EVENT, handleNavigationIntent);
  }, [capability.quality, destination, spatial]);

  const activeDestination = isSpatialWorkspaceDestination(destination) ? destination : null;
  const routeDefinition = spatial && activeDestination ? spatialDestinationDefinition(activeDestination) : null;
  const effectiveTravel = spatial ? travel || (activeDestination ? spatialTravelPlan(activeDestination, activeDestination) : null) : null;
  const spatialStyle = useMemo(() => {
    if (!routeDefinition || !effectiveTravel) return undefined;
    const arrival = routeDefinition.surface.arrival;
    return {
      "--vaeroex-surface-inset": routeDefinition.surface.inset,
      "--vaeroex-transform-origin": routeDefinition.surface.transformOrigin,
      "--vaeroex-route-travel-duration": `${effectiveTravel.durationMs}ms`,
      "--vaeroex-route-departure-duration": `${effectiveTravel.departureMs}ms`,
      "--vaeroex-depart-x": `${effectiveTravel.departX}px`,
      "--vaeroex-depart-y": `${effectiveTravel.departY}px`,
      "--vaeroex-depart-rotate-x": `${effectiveTravel.departRotateX}deg`,
      "--vaeroex-depart-rotate-y": `${effectiveTravel.departRotateY}deg`,
      "--vaeroex-arrive-x": `${arrival.x}px`,
      "--vaeroex-arrive-y": `${arrival.y}px`,
      "--vaeroex-arrive-z": `${arrival.z}px`,
      "--vaeroex-arrive-rotate-x": `${arrival.rotateX}deg`,
      "--vaeroex-arrive-rotate-y": `${arrival.rotateY}deg`,
      "--vaeroex-arrive-scale": arrival.scale
    } as CSSProperties;
  }, [effectiveTravel, routeDefinition]);

  return (
    <div
      className={`vaeroex-workspace-shell${spatial ? " vaeroex-workspace-shell--enabled" : ""}${spatial && environmentReady ? " vaeroex-workspace-shell--active" : ""}`}
      data-spatial-workspace={destination}
      data-spatial-capability={capability.ready ? capability.quality || capability.reason || "unavailable" : "checking"}
      data-spatial-align={routeDefinition?.surface.alignment}
      data-spatial-motion={spatial ? motion : "settled"}
      data-spatial-ready={spatial && environmentReady ? "true" : "false"}
      data-workspace-experience={experienceReady ? experience : "checking"}
      style={spatialStyle}
    >
      {spatial && cameraDestination ? (
        <SpatialErrorBoundary fallback={null} onError={() => setEnvironmentReady(false)}>
          <SpatialWorkspaceCanvas
            destination={cameraDestination}
            onReady={markEnvironmentReady}
            quality={capability.quality || "constrained"}
            transitionMs={effectiveTravel?.durationMs || spatialDestinationDefinition(cameraDestination).camera.transitionMs}
          />
        </SpatialErrorBoundary>
      ) : null}
      <SpatialRoutePlane destination={destination} enhanced={spatial} motion={motion}>{children}</SpatialRoutePlane>
    </div>
  );
}
