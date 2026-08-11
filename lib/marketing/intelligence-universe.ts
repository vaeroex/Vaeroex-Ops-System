import type { Route } from "next";

export type IntelligenceUniverseDestination =
  | "vaeroex"
  | "intelligence-systems"
  | "executive-intelligence"
  | "drug-discovery-intelligence"
  | "biological-intelligence"
  | "trust"
  | "pricing"
  | "company"
  | "network"
  | "careers"
  | "contact";

export type IntelligenceUniverseSystemDestination =
  | "executive-intelligence"
  | "drug-discovery-intelligence"
  | "biological-intelligence";

export type IntelligenceUniverseRegionDestination = Exclude<
  IntelligenceUniverseDestination,
  IntelligenceUniverseSystemDestination
>;

export type IntelligenceUniverseLevel = "master" | "systems" | "region" | "approach" | "deep";
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
  selectedDestination: IntelligenceUniverseDestination;
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

export type IntelligenceUniverseDestinationDefinition = Readonly<{
  route: Route;
  name: string;
  shortName: string;
  code: string;
  statusLabel: string;
  description: string;
  kind: "core" | "systems" | "system" | "trust" | "pricing" | "company" | "network" | "careers" | "contact";
  accent: string;
}>;

export const INTELLIGENCE_UNIVERSE_SYSTEMS = [
  "executive-intelligence",
  "drug-discovery-intelligence",
  "biological-intelligence"
] as const satisfies readonly IntelligenceUniverseSystemDestination[];

export const INTELLIGENCE_UNIVERSE_DESTINATIONS = [
  "vaeroex",
  "intelligence-systems",
  "executive-intelligence",
  "drug-discovery-intelligence",
  "biological-intelligence",
  "trust",
  "pricing",
  "company",
  "network",
  "careers",
  "contact"
] as const satisfies readonly IntelligenceUniverseDestination[];

export const INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS = [
  "vaeroex",
  "intelligence-systems",
  "trust",
  "pricing",
  "company",
  "network",
  "careers",
  "contact"
] as const satisfies readonly IntelligenceUniverseRegionDestination[];

export const INTELLIGENCE_UNIVERSE_START_POSITION: Readonly<IntelligenceUniverseVector3> = {
  x: 0,
  y: 4,
  z: 26
};

export const INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS: Readonly<
  Record<IntelligenceUniverseDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  vaeroex: { x: 0, y: 4, z: -2 },
  "intelligence-systems": { x: 2, y: 5, z: -24 },
  "executive-intelligence": { x: -24, y: 8, z: -38 },
  "drug-discovery-intelligence": { x: 18, y: -10, z: -66 },
  "biological-intelligence": { x: 40, y: 16, z: -48 },
  trust: { x: -58, y: 16, z: -32 },
  pricing: { x: 54, y: -19, z: -5 },
  company: { x: -50, y: -18, z: 5 },
  network: { x: 68, y: -5, z: -38 },
  careers: { x: -10, y: 34, z: -48 },
  contact: { x: 24, y: -30, z: 12 }
};

export const INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS: Readonly<
  Record<IntelligenceUniverseDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  vaeroex: { x: 0, y: 4, z: 24 },
  "intelligence-systems": { x: 2, y: 6, z: 0 },
  "executive-intelligence": { x: -24, y: 8.8, z: -16 },
  "drug-discovery-intelligence": { x: 18, y: -9.2, z: -43 },
  "biological-intelligence": { x: 40, y: 16.8, z: -25 },
  trust: { x: -58, y: 17, z: -5 },
  pricing: { x: 54, y: -18, z: 20 },
  company: { x: -50, y: -16, z: 29 },
  network: { x: 68, y: -4, z: -12 },
  careers: { x: -10, y: 32, z: -20 },
  contact: { x: 24, y: -27, z: 34 }
};

export const INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS: Readonly<
  Record<IntelligenceUniverseDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  vaeroex: { x: 0, y: 4, z: 12 },
  "intelligence-systems": { x: 2, y: 5, z: -11 },
  "executive-intelligence": { x: -24, y: 8.45, z: -26 },
  "drug-discovery-intelligence": { x: 18, y: -9.55, z: -55 },
  "biological-intelligence": { x: 40, y: 16.45, z: -37 },
  trust: { x: -58, y: 16, z: -18 },
  pricing: { x: 54, y: -19, z: 8 },
  company: { x: -50, y: -18, z: 18 },
  network: { x: 68, y: -5, z: -24 },
  careers: { x: -10, y: 34, z: -34 },
  contact: { x: 24, y: -29, z: 24 }
};

export const INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS: Readonly<
  Record<IntelligenceUniverseSystemDestination, Readonly<IntelligenceUniverseVector3>>
> = {
  "executive-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS["executive-intelligence"],
  "drug-discovery-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS["drug-discovery-intelligence"],
  "biological-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS["biological-intelligence"]
};

export const INTELLIGENCE_UNIVERSE_BOUNDS = {
  x: [-76, 82],
  y: [-40, 43],
  z: [-82, 40]
} as const;

export const INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS: Readonly<
  Record<IntelligenceUniverseDestination, IntelligenceUniverseDestinationDefinition>
> = {
  vaeroex: {
    route: "/",
    name: "Vaeroex",
    shortName: "Core",
    code: "VX / CORE",
    statusLabel: "Intelligence Systems",
    description: "Transforming information into visibility, awareness, prediction, and action.",
    kind: "core",
    accent: "#7ee6ff"
  },
  "intelligence-systems": {
    route: "/intelligence-systems",
    name: "Intelligence Systems",
    shortName: "Systems",
    code: "IS / FIELD",
    statusLabel: "Three specialized areas",
    description: "Specialized intelligence environments for distinct domains.",
    kind: "systems",
    accent: "#7bd7e8"
  },
  "executive-intelligence": {
    route: "/executive-intelligence",
    name: "Executive Intelligence",
    shortName: "Executive",
    code: "EI / 01",
    statusLabel: "Available",
    description: "Operational signals resolved into an inspectable decision environment.",
    kind: "system",
    accent: "#66d9f5"
  },
  "drug-discovery-intelligence": {
    route: "/drug-discovery-intelligence",
    name: "Drug Discovery Intelligence",
    shortName: "Discovery",
    code: "DD / 02",
    statusLabel: "In Development",
    description: "Molecular and structural research intelligence across a computational discovery field.",
    kind: "system",
    accent: "#73ddd2"
  },
  "biological-intelligence": {
    route: "/biological-intelligence",
    name: "Biological Intelligence",
    shortName: "Biological",
    code: "BI / 03",
    statusLabel: "In Development",
    description: "Multi-scale biological information shaped into coherent systems intelligence.",
    kind: "system",
    accent: "#79bff3"
  },
  trust: {
    route: "/trust",
    name: "Trust",
    shortName: "Trust",
    code: "TR / 04",
    statusLabel: "Inspect and control",
    description: "Intelligence you can inspect, understand, and control.",
    kind: "trust",
    accent: "#79d9c7"
  },
  pricing: {
    route: "/pricing",
    name: "Pricing",
    shortName: "Pricing",
    code: "PR / 05",
    statusLabel: "Availability",
    description: "Current availability and pricing across specialized intelligence.",
    kind: "pricing",
    accent: "#e3c883"
  },
  company: {
    route: "/about",
    name: "Company",
    shortName: "Company",
    code: "CO / 06",
    statusLabel: "About Vaeroex",
    description: "Why Vaeroex is being built to make complex information more useful.",
    kind: "company",
    accent: "#b7c9e8"
  },
  network: {
    route: "/networking",
    name: "Vaeroex Network",
    shortName: "Network",
    code: "NW / 07",
    statusLabel: "Relationships",
    description: "A curated network for operators, experts, partners, and aligned organizations.",
    kind: "network",
    accent: "#9ad9d0"
  },
  careers: {
    route: "/careers",
    name: "Careers",
    shortName: "Careers",
    code: "CR / 08",
    statusLabel: "Future interest",
    description: "Future work for builders, operators, and specialists who value clarity and evidence.",
    kind: "careers",
    accent: "#b5a8eb"
  },
  contact: {
    route: "/contact",
    name: "Contact",
    shortName: "Contact",
    code: "CT / 09",
    statusLabel: "Connect",
    description: "Start a focused conversation with Vaeroex.",
    kind: "contact",
    accent: "#efb49f"
  }
};

export const INTELLIGENCE_UNIVERSE_ROUTES: Readonly<Record<IntelligenceUniverseDestination, Route>> = {
  vaeroex: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.vaeroex.route,
  "intelligence-systems": INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS["intelligence-systems"].route,
  "executive-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS["executive-intelligence"].route,
  "drug-discovery-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS["drug-discovery-intelligence"].route,
  "biological-intelligence": INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS["biological-intelligence"].route,
  trust: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.trust.route,
  pricing: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.pricing.route,
  company: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.company.route,
  network: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.network.route,
  careers: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.careers.route,
  contact: INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS.contact.route
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
  if (isUniverseSystemDestination(destination)) return phase === "deep" ? "deep" : "approach";
  return "region";
}

export function adjacentUniverseSystem(
  current: IntelligenceUniverseSystemDestination,
  direction: -1 | 1
): IntelligenceUniverseSystemDestination {
  const currentIndex = INTELLIGENCE_UNIVERSE_SYSTEMS.indexOf(current);
  const nextIndex = (currentIndex + direction + INTELLIGENCE_UNIVERSE_SYSTEMS.length) % INTELLIGENCE_UNIVERSE_SYSTEMS.length;
  return INTELLIGENCE_UNIVERSE_SYSTEMS[nextIndex];
}

export function adjacentUniverseDestination(
  current: IntelligenceUniverseDestination,
  direction: -1 | 1
): IntelligenceUniverseDestination {
  const currentIndex = INTELLIGENCE_UNIVERSE_DESTINATIONS.indexOf(current);
  const nextIndex = (currentIndex + direction + INTELLIGENCE_UNIVERSE_DESTINATIONS.length) % INTELLIGENCE_UNIVERSE_DESTINATIONS.length;
  return INTELLIGENCE_UNIVERSE_DESTINATIONS[nextIndex];
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

export function distanceToUniverseDestination(
  position: Readonly<IntelligenceUniverseVector3>,
  destination: IntelligenceUniverseDestination
) {
  return distanceBetweenUniversePoints(position, INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[destination]);
}

export function distanceToUniverseSystem(
  position: Readonly<IntelligenceUniverseVector3>,
  destination: IntelligenceUniverseSystemDestination
) {
  return distanceToUniverseDestination(position, destination);
}

export function nearestUniverseDestination(
  position: Readonly<IntelligenceUniverseVector3>
): IntelligenceUniverseDestination {
  return INTELLIGENCE_UNIVERSE_DESTINATIONS.reduce((nearest, destination) => (
    distanceToUniverseDestination(position, destination) < distanceToUniverseDestination(position, nearest)
      ? destination
      : nearest
  ), INTELLIGENCE_UNIVERSE_DESTINATIONS[0]);
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
  if (distance <= 62) return "signal";
  return "open_field";
}

export function createUniverseMotion(
  selectedDestination: IntelligenceUniverseDestination,
  approachProgress = 0
): IntelligenceUniverseMotion {
  const initialPosition = approachProgress > 0
    ? INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[selectedDestination]
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
  const phase: IntelligenceUniversePhase = destination === "vaeroex" ? "idle" : "arriving";

  return {
    current: destination,
    target: destination,
    selectedDestination: destination,
    selectedSystem: productDestination ? destination : "executive-intelligence",
    proximity: destination === "vaeroex" ? "open_field" : "near",
    route: INTELLIGENCE_UNIVERSE_ROUTES[destination],
    level: universeLevelForDestination(destination, phase),
    phase,
    inputLocked: destination !== "vaeroex",
    reducedMotion: false,
    quality: "pending",
    assetReadiness: {
      "executive-intelligence": destination === "executive-intelligence" ? "approach" : "distant",
      "drug-discovery-intelligence": destination === "drug-discovery-intelligence" ? "approach" : "distant",
      "biological-intelligence": destination === "biological-intelligence" ? "approach" : "distant"
    }
  };
}
