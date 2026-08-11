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
export type IntelligenceUniverseProximity = "open_field" | "signal" | "near";
export type IntelligenceUniverseMotionMode =
  | "idle"
  | "dragging"
  | "coasting"
  | "settling"
  | "approaching"
  | "retreating"
  | "fast_travel";

export type IntelligenceUniverseTravelStage = "overview" | "pullback" | "crossing" | "approach";

export type IntelligenceUniverseVector3 = {
  x: number;
  y: number;
  z: number;
};

export type IntelligenceUniverseMotion = {
  position: IntelligenceUniverseVector3;
  targetPosition: IntelligenceUniverseVector3;
  velocity: IntelligenceUniverseVector3;
  approachProgress: number;
  approachTarget: number;
  dragging: boolean;
  dragOriginX: number | null;
  dragOriginY: number | null;
  dragLastX: number | null;
  dragLastY: number | null;
  dragLastAt: number | null;
  mode: IntelligenceUniverseMotionMode;
  travelStage: IntelligenceUniverseTravelStage;
  suppressClickUntil: number;
};

export type IntelligenceUniverseState = Readonly<{
  current: IntelligenceUniverseDestination;
  target: IntelligenceUniverseDestination;
  selectedSystem: IntelligenceUniverseSystemDestination;
  proximity: IntelligenceUniverseProximity;
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

export const INTELLIGENCE_UNIVERSE_START_POSITION: Readonly<IntelligenceUniverseVector3> = {
  x: 0,
  y: 4,
  z: 26
};

export const INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS: Readonly<
  Record<IntelligenceUniverseSystemDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  "executive-intelligence": { x: -24, y: 8, z: -38 },
  "drug-discovery-intelligence": { x: 18, y: -10, z: -66 },
  "biological-intelligence": { x: 40, y: 16, z: -48 }
};

export const INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS: Readonly<
  Record<IntelligenceUniverseSystemDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  "executive-intelligence": { x: -24, y: 8.8, z: -16 },
  "drug-discovery-intelligence": { x: 18, y: -9.2, z: -43 },
  "biological-intelligence": { x: 40, y: 16.8, z: -25 }
};

export const INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS: Readonly<
  Record<IntelligenceUniverseSystemDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  "executive-intelligence": { x: -24, y: 8.45, z: -26 },
  "drug-discovery-intelligence": { x: 18, y: -9.55, z: -55 },
  "biological-intelligence": { x: 40, y: 16.45, z: -37 }
};

export const INTELLIGENCE_UNIVERSE_BOUNDS = {
  x: [-48, 50],
  y: [-26, 30],
  z: [-46, 34]
} as const;

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

function copyVector(vector: Readonly<IntelligenceUniverseVector3>): IntelligenceUniverseVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function resistAxis(position: number, delta: number, bounds: readonly [number, number]) {
  const [minimum, maximum] = bounds;
  const resistanceBand = Math.max(7, (maximum - minimum) * 0.14);
  const distanceToBoundary = delta < 0 ? position - minimum : maximum - position;
  const resistance = distanceToBoundary >= resistanceBand
    ? 1
    : 0.16 + 0.84 * Math.max(0, distanceToBoundary) / resistanceBand;
  return Math.min(maximum, Math.max(minimum, position + delta * resistance));
}

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

export function moveUniversePosition(
  position: Readonly<IntelligenceUniverseVector3>,
  delta: Readonly<IntelligenceUniverseVector3>
): IntelligenceUniverseVector3 {
  return {
    x: resistAxis(position.x, delta.x, INTELLIGENCE_UNIVERSE_BOUNDS.x),
    y: resistAxis(position.y, delta.y, INTELLIGENCE_UNIVERSE_BOUNDS.y),
    z: resistAxis(position.z, delta.z, INTELLIGENCE_UNIVERSE_BOUNDS.z)
  };
}

export function clampUniversePosition(
  position: Readonly<IntelligenceUniverseVector3>
): IntelligenceUniverseVector3 {
  return {
    x: Math.min(INTELLIGENCE_UNIVERSE_BOUNDS.x[1], Math.max(INTELLIGENCE_UNIVERSE_BOUNDS.x[0], position.x)),
    y: Math.min(INTELLIGENCE_UNIVERSE_BOUNDS.y[1], Math.max(INTELLIGENCE_UNIVERSE_BOUNDS.y[0], position.y)),
    z: Math.min(INTELLIGENCE_UNIVERSE_BOUNDS.z[1], Math.max(INTELLIGENCE_UNIVERSE_BOUNDS.z[0], position.z))
  };
}

export function distanceBetweenUniversePoints(
  left: Readonly<IntelligenceUniverseVector3>,
  right: Readonly<IntelligenceUniverseVector3>
) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function distanceToUniverseSystem(
  position: Readonly<IntelligenceUniverseVector3>,
  destination: IntelligenceUniverseSystemDestination
) {
  return distanceBetweenUniversePoints(position, INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS[destination]);
}

export function nearestUniverseSystem(
  position: Readonly<IntelligenceUniverseVector3>
): IntelligenceUniverseSystemDestination {
  return INTELLIGENCE_UNIVERSE_SYSTEMS.reduce((nearest, destination) => (
    distanceToUniverseSystem(position, destination) < distanceToUniverseSystem(position, nearest)
      ? destination
      : nearest
  ), INTELLIGENCE_UNIVERSE_SYSTEMS[0]);
}

export function universeProximityForDistance(distance: number): IntelligenceUniverseProximity {
  if (distance <= 30) return "near";
  if (distance <= 56) return "signal";
  return "open_field";
}

export function createUniverseMotion(
  selectedSystem: IntelligenceUniverseSystemDestination,
  approachProgress = 0
): IntelligenceUniverseMotion {
  const initialPosition = approachProgress > 0
    ? INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[selectedSystem]
    : INTELLIGENCE_UNIVERSE_START_POSITION;
  return {
    position: copyVector(initialPosition),
    targetPosition: copyVector(initialPosition),
    velocity: { x: 0, y: 0, z: 0 },
    approachProgress,
    approachTarget: approachProgress,
    dragging: false,
    dragOriginX: null,
    dragOriginY: null,
    dragLastX: null,
    dragLastY: null,
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
    proximity: productDestination ? "near" : "open_field",
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
