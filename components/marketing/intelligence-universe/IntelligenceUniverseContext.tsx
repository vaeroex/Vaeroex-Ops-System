"use client";

import { createContext, useContext } from "react";
import {
  initialUniverseState,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";

export type IntelligenceUniverseContextValue = Readonly<{
  state: IntelligenceUniverseState;
  enabled: boolean;
  shellVisible: boolean;
  routeIsCompatible: boolean;
  setEnabled: (enabled: boolean) => void;
  travel: (destination: IntelligenceUniverseDestination) => void;
  selectSystem: (destination: IntelligenceUniverseSystemDestination) => void;
  selectAdjacentSystem: (direction: -1 | 1) => void;
  enterSelectedSystem: () => void;
  setQuality: (quality: IntelligenceUniverseState["quality"]) => void;
  suppressBackdrop: (destination: IntelligenceUniverseDestination) => boolean;
}>;

const defaultState = initialUniverseState("/");

export const IntelligenceUniverseContext = createContext<IntelligenceUniverseContextValue>({
  state: defaultState,
  enabled: false,
  shellVisible: false,
  routeIsCompatible: false,
  setEnabled: () => undefined,
  travel: () => undefined,
  selectSystem: () => undefined,
  selectAdjacentSystem: () => undefined,
  enterSelectedSystem: () => undefined,
  setQuality: () => undefined,
  suppressBackdrop: () => false
});

export function useIntelligenceUniverse() {
  return useContext(IntelligenceUniverseContext);
}
