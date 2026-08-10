export type SpatialWorkspaceDestination =
  | "overview"
  | "intelligence"
  | "kpis"
  | "sources"
  | "analyses"
  | "flat";

export type ActiveSpatialWorkspaceDestination = Exclude<SpatialWorkspaceDestination, "flat">;

export type SpatialDestinationDefinition = Readonly<{
  id: ActiveSpatialWorkspaceDestination;
  route: string;
  matches: (pathname: string) => boolean;
  region: readonly [number, number, number];
  camera: Readonly<{
    position: readonly [number, number, number];
    target: readonly [number, number, number];
    fov: number;
    transitionMs: number;
    arcHeight: number;
    lateralBias: number;
  }>;
  surface: Readonly<{
    alignment: "start" | "end";
    inset: string;
    transformOrigin: string;
    arrival: Readonly<{
      x: number;
      y: number;
      z: number;
      rotateX: number;
      rotateY: number;
      scale: number;
    }>;
  }>;
  environment: Readonly<{
    accent: string;
    signalPhase: number;
    structuralDepth: number;
  }>;
}>;

function exactOrDescendant(route: string) {
  return (pathname: string) => pathname === route || pathname.startsWith(`${route}/`);
}

export const SPATIAL_DESTINATIONS = Object.freeze([
  {
    id: "overview",
    route: "/app",
    matches: (pathname: string) => pathname === "/app",
    region: [0, 0, 0],
    camera: {
      position: [2.8, 3.55, 17.2],
      target: [2.05, -0.25, -0.35],
      fov: 44,
      transitionMs: 660,
      arcHeight: 1.65,
      lateralBias: -1.15
    },
    surface: {
      alignment: "start",
      inset: "clamp(7rem, 17vw, 11rem)",
      transformOrigin: "18% 24%",
      arrival: { x: 64, y: 16, z: -170, rotateX: 2.2, rotateY: -5.5, scale: 0.93 }
    },
    environment: { accent: "#9adbe6", signalPhase: 0.08, structuralDepth: 0 }
  },
  {
    id: "intelligence",
    route: "/app/intelligence",
    matches: exactOrDescendant("/app/intelligence"),
    region: [-15.5, 0.55, -14.2],
    camera: {
      position: [-12.2, 3.35, -1.2],
      target: [-14.75, -0.05, -13.35],
      fov: 39,
      transitionMs: 760,
      arcHeight: 2.5,
      lateralBias: 1.9
    },
    surface: {
      alignment: "end",
      inset: "clamp(6rem, 12vw, 8rem)",
      transformOrigin: "82% 24%",
      arrival: { x: -72, y: 14, z: -190, rotateX: 2, rotateY: 6, scale: 0.925 }
    },
    environment: { accent: "#88cddd", signalPhase: 0.28, structuralDepth: -0.7 }
  },
  {
    id: "kpis",
    route: "/app/kpis",
    matches: exactOrDescendant("/app/kpis"),
    region: [15.8, 0.15, -16.8],
    camera: {
      position: [12.5, 3.45, -3.5],
      target: [15.1, -0.2, -16],
      fov: 38,
      transitionMs: 760,
      arcHeight: 2.35,
      lateralBias: -1.85
    },
    surface: {
      alignment: "start",
      inset: "clamp(6rem, 12vw, 8rem)",
      transformOrigin: "18% 26%",
      arrival: { x: 74, y: 12, z: -185, rotateX: 2.1, rotateY: -6.2, scale: 0.925 }
    },
    environment: { accent: "#aec8cf", signalPhase: 0.5, structuralDepth: -1.2 }
  },
  {
    id: "sources",
    route: "/app/sources",
    matches: exactOrDescendant("/app/sources"),
    region: [7.1, -0.45, -34],
    camera: {
      position: [10, 3.05, -21],
      target: [7.35, -0.45, -33.15],
      fov: 41,
      transitionMs: 860,
      arcHeight: 2.8,
      lateralBias: -1.65
    },
    surface: {
      alignment: "start",
      inset: "clamp(5rem, 11vw, 7.5rem)",
      transformOrigin: "20% 24%",
      arrival: { x: 68, y: 18, z: -205, rotateX: 2.4, rotateY: -5, scale: 0.915 }
    },
    environment: { accent: "#b9ad82", signalPhase: 0.7, structuralDepth: -1.8 }
  },
  {
    id: "analyses",
    route: "/app/reports",
    matches: exactOrDescendant("/app/reports"),
    region: [-13.8, -0.1, -32.1],
    camera: {
      position: [-10.8, 3.05, -18.8],
      target: [-13.15, -0.25, -31.2],
      fov: 40,
      transitionMs: 860,
      arcHeight: 2.75,
      lateralBias: 1.7
    },
    surface: {
      alignment: "end",
      inset: "clamp(5.5rem, 11vw, 7.5rem)",
      transformOrigin: "80% 25%",
      arrival: { x: -70, y: 18, z: -205, rotateX: 2.3, rotateY: 5.5, scale: 0.915 }
    },
    environment: { accent: "#93a9bf", signalPhase: 0.88, structuralDepth: -1.5 }
  }
] satisfies readonly SpatialDestinationDefinition[]);

export const SPATIAL_WORKSPACE_ROUTES: Readonly<Record<ActiveSpatialWorkspaceDestination, string>> =
  Object.freeze(Object.fromEntries(SPATIAL_DESTINATIONS.map((destination) => [destination.id, destination.route])) as Record<ActiveSpatialWorkspaceDestination, string>);

export function spatialDestinationDefinition(destination: ActiveSpatialWorkspaceDestination) {
  const definition = SPATIAL_DESTINATIONS.find((candidate) => candidate.id === destination);
  if (!definition) throw new Error(`Unknown spatial destination: ${destination}`);
  return definition;
}

export function spatialDestinationForPathname(pathname: string): SpatialWorkspaceDestination {
  return SPATIAL_DESTINATIONS.find((destination) => destination.matches(pathname))?.id || "flat";
}

export function isSpatialWorkspaceDestination(
  destination: SpatialWorkspaceDestination
): destination is ActiveSpatialWorkspaceDestination {
  return destination !== "flat";
}

export type SpatialTravelPlan = Readonly<{
  distance: number;
  durationMs: number;
  departureMs: number;
  departX: number;
  departY: number;
  departRotateX: number;
  departRotateY: number;
}>;

export type SpatialNavigationIntentDetail = Readonly<{
  from: ActiveSpatialWorkspaceDestination;
  to: ActiveSpatialWorkspaceDestination;
}>;

export const SPATIAL_NAVIGATION_INTENT_EVENT = "vaeroex:spatial-navigation-intent";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function spatialTravelPlan(
  from: ActiveSpatialWorkspaceDestination,
  to: ActiveSpatialWorkspaceDestination
): SpatialTravelPlan {
  const fromDefinition = spatialDestinationDefinition(from);
  const toDefinition = spatialDestinationDefinition(to);
  const deltaX = toDefinition.region[0] - fromDefinition.region[0];
  const deltaY = toDefinition.region[1] - fromDefinition.region[1];
  const deltaZ = toDefinition.region[2] - fromDefinition.region[2];
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  const durationMs = Math.round(clamp(toDefinition.camera.transitionMs + Math.max(0, distance - 14) * 13, 650, 1200));

  return {
    distance,
    durationMs,
    departureMs: Math.round(clamp(durationMs * 0.22, 160, 240)),
    departX: Math.round(clamp(-deltaX * 3.1, -82, 82)),
    departY: Math.round(clamp(12 + Math.abs(deltaZ) * 0.36, 14, 26)),
    departRotateX: Number(clamp(1.4 + Math.abs(deltaZ) * 0.055, 1.6, 2.8).toFixed(2)),
    departRotateY: Number(clamp(deltaX * 0.28, -6.5, 6.5).toFixed(2))
  };
}
