"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import {
  createUniverseMotion,
  initialUniverseState,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination,
  type IntelligenceUniverseVector3
} from "@/lib/marketing/intelligence-universe";

export type IntelligenceUniverseContextValue = Readonly<{
  state: IntelligenceUniverseState;
  enabled: boolean;
  shellVisible: boolean;
  routeIsCompatible: boolean;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  setEnabled: (enabled: boolean) => void;
  travel: (destination: IntelligenceUniverseDestination) => void;
  selectSystem: (destination: IntelligenceUniverseSystemDestination) => void;
  selectAdjacentSystem: (direction: -1 | 1) => void;
  enterSelectedSystem: () => void;
  enterSystem: (destination: IntelligenceUniverseSystemDestination) => void;
  beginExplorationDrag: (clientX: number, clientY: number, at: number) => void;
  updateExplorationDrag: (
    clientX: number,
    clientY: number,
    at: number,
    viewportWidth: number,
    viewportHeight: number
  ) => void;
  endExplorationDrag: (at: number) => void;
  nudgeExploration: (delta: IntelligenceUniverseVector3) => void;
  setQuality: (quality: IntelligenceUniverseState["quality"]) => void;
  suppressBackdrop: (destination: IntelligenceUniverseDestination) => boolean;
}>;

const defaultState = initialUniverseState("/");
const defaultMotion = { current: createUniverseMotion(defaultState.selectedSystem) };

export const IntelligenceUniverseContext = createContext<IntelligenceUniverseContextValue>({
  state: defaultState,
  enabled: false,
  shellVisible: false,
  routeIsCompatible: false,
  motion: defaultMotion,
  setEnabled: () => undefined,
  travel: () => undefined,
  selectSystem: () => undefined,
  selectAdjacentSystem: () => undefined,
  enterSelectedSystem: () => undefined,
  enterSystem: () => undefined,
  beginExplorationDrag: () => undefined,
  updateExplorationDrag: () => undefined,
  endExplorationDrag: () => undefined,
  nudgeExploration: () => undefined,
  setQuality: () => undefined,
  suppressBackdrop: () => false
});

export function useIntelligenceUniverse() {
  return useContext(IntelligenceUniverseContext);
}
