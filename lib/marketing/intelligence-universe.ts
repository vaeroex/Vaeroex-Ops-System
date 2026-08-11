import type { Route } from "next";

export type IntelligenceUniverseDestination =
  | "vaeroex"
  | "intelligence-systems"
  | "executive-intelligence"
  | "drug-discovery-intelligence"
  | "biological-intelligence";

export type IntelligenceUniverseSystemDestination = Exclude<
  IntelligenceUniverseDestination,
  "vaeroex" | "intelligence-systems"
>;

export type IntelligenceUniverseLevel = "master" | "systems" | "approach" | "deep";
export type IntelligenceUniversePhase = "idle" | "transitioning" | "arriving" | "deep";
export type IntelligenceUniverseAssetLevel = "distant" | "approach" | "detail";
export type IntelligenceUniverseMotionMode =
  | "idle"
  | "dragging"
  | "settling"
  | "approaching"
  | "retreating"
  | "fast_travel";

export type IntelligenceUniverseTravelStage = "overview" | "pullback" | "crossing" | "approach";

export type IntelligenceUniverseMotion = {
  railProgress: number;
  railTarget: number;
  velocity: number;
  approachProgress: number;
  approachTarget: number;
  dragging: boolean;
  dragOriginX: number | null;
  dragLastX: number | null;
  dragLastAt: number | null;
  mode: IntelligenceUniverseMotionMode;
  travelStage: IntelligenceUniverseTravelStage;
  suppressClickUntil: number;
};

export type IntelligenceUniverseState = Readonly<{
  current: IntelligenceUniverseDestination;
  target: IntelligenceUniverseDestination;
  selectedSystem: IntelligenceUniverseSystemDestination;
  route: Route;
  level: IntelligenceUniverseLevel;
  phase: IntelligenceUniversePhase;
  inputLocked: boolean;
  reducedMotion: boolean;
  quality: "full" | "constrained" | "reduced_motion" | "fallback" | "pending";
  assetReadiness: Readonly<Record<IntelligenceUniverseSystemDestination, IntelligenceUniverseAssetLevel>>;
}>;

export const INTELLIGENCE_UNIVERSE_SYSTEMS = [
  "executive-intelligence",
  "drug-discovery-intelligence",
  "biological-intelligence"
] as const satisfies readonly IntelligenceUniverseSystemDestination[];

export const INTELLIGENCE_UNIVERSE_RAIL_ANCHORS: Readonly<
  Record<IntelligenceUniverseSystemDestination, number>
> = {
  "executive-intelligence": -1,
  "drug-discovery-intelligence": 0,
  "biological-intelligence": 1
};

const RAIL_MIN = -1.14;
const RAIL_MAX = 1.14;

export const INTELLIGENCE_UNIVERSE_ROUTES: Readonly<Record<IntelligenceUniverseDestination, Route>> = {
  vaeroex: "/",
  "intelligence-systems": "/intelligence-systems",
  "executive-intelligence": "/executive-intelligence",
  "drug-discovery-intelligence": "/drug-discovery-intelligence",
  "biological-intelligence": "/biological-intelligence"
};

const destinationByRoute = new Map<string, IntelligenceUniverseDestination>(
  Object.entries(INTELLIGENCE_UNIVERSE_ROUTES).map(([destination, route]) => [route, destination as IntelligenceUniverseDestination])
);

export function universeDestinationForPathname(pathname: string): IntelligenceUniverseDestination | null {
  return destinationByRoute.get(pathname) || null;
}

export function isUniverseSystemDestination(
  destination: IntelligenceUniverseDestination
): destination is IntelligenceUniverseSystemDestination {
  return INTELLIGENCE_UNIVERSE_SYSTEMS.includes(destination as IntelligenceUniverseSystemDestination);
}

export function universeLevelForDestination(
  destination: IntelligenceUniverseDestination,
  phase: IntelligenceUniversePhase
): IntelligenceUniverseLevel {
  if (destination === "vaeroex") return "master";
  if (destination === "intelligence-systems") return "systems";
  return phase === "deep" ? "deep" : "approach";
}

export function adjacentUniverseSystem(
  current: IntelligenceUniverseSystemDestination,
  direction: -1 | 1
): IntelligenceUniverseSystemDestination {
  const currentIndex = INTELLIGENCE_UNIVERSE_SYSTEMS.indexOf(current);
  const nextIndex = (currentIndex + direction + INTELLIGENCE_UNIVERSE_SYSTEMS.length) % INTELLIGENCE_UNIVERSE_SYSTEMS.length;
  return INTELLIGENCE_UNIVERSE_SYSTEMS[nextIndex];
}

export function clampUniverseRailProgress(progress: number) {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, progress));
}

export function nearestUniverseSystem(progress: number): IntelligenceUniverseSystemDestination {
  return INTELLIGENCE_UNIVERSE_SYSTEMS.reduce((nearest, destination) => (
    Math.abs(INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[destination] - progress)
      < Math.abs(INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[nearest] - progress)
      ? destination
      : nearest
  ), INTELLIGENCE_UNIVERSE_SYSTEMS[0]);
}

export function createUniverseMotion(
  selectedSystem: IntelligenceUniverseSystemDestination,
  approachProgress = 0
): IntelligenceUniverseMotion {
  const railProgress = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[selectedSystem];
  return {
    railProgress,
    railTarget: railProgress,
    velocity: 0,
    approachProgress,
    approachTarget: approachProgress,
    dragging: false,
    dragOriginX: null,
    dragLastX: null,
    dragLastAt: null,
    mode: "idle",
    travelStage: approachProgress > 0 ? "approach" : "overview",
    suppressClickUntil: 0
  };
}

export function initialUniverseState(pathname: string): IntelligenceUniverseState {
  const destination = universeDestinationForPathname(pathname) || "vaeroex";
  const productDestination = isUniverseSystemDestination(destination);
  const phase: IntelligenceUniversePhase = productDestination ? "arriving" : "idle";

  return {
    current: destination,
    target: destination,
    selectedSystem: productDestination ? destination : "executive-intelligence",
    route: INTELLIGENCE_UNIVERSE_ROUTES[destination],
    level: universeLevelForDestination(destination, phase),
    phase,
    inputLocked: productDestination,
    reducedMotion: false,
    quality: "pending",
    assetReadiness: {
      "executive-intelligence": destination === "executive-intelligence" ? "approach" : "distant",
      "drug-discovery-intelligence": destination === "drug-discovery-intelligence" ? "approach" : "distant",
      "biological-intelligence": destination === "biological-intelligence" ? "approach" : "distant"
    }
  };
}
