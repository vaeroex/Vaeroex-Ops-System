"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import {
  createUniverseMotion,
  initialUniverseState,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
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
  beginRailDrag: (clientX: number, at: number) => void;
  updateRailDrag: (clientX: number, at: number, viewportWidth: number) => void;
  endRailDrag: (at: number) => void;
  moveRailBy: (delta: number) => void;
  settleRail: () => void;
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
  beginRailDrag: () => undefined,
  updateRailDrag: () => undefined,
  endRailDrag: () => undefined,
  moveRailBy: () => undefined,
  settleRail: () => undefined,
  setQuality: () => undefined,
  suppressBackdrop: () => false
});

export function useIntelligenceUniverse() {
  return useContext(IntelligenceUniverseContext);
}
