"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import {
  createUniverseMotion,
  initialUniverseState,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState
} from "@/lib/marketing/intelligence-universe";

export type IntelligenceUniverseContextValue = Readonly<{
  state: IntelligenceUniverseState;
  enabled: boolean;
  shellVisible: boolean;
  controlsVisible: boolean;
  routeIsCompatible: boolean;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  setEnabled: (enabled: boolean) => void;
  travel: (destination: IntelligenceUniverseDestination) => void;
  setQuality: (quality: IntelligenceUniverseState["quality"]) => void;
  suppressBackdrop: (destination: IntelligenceUniverseDestination) => boolean;
}>;

const defaultState = initialUniverseState("/");
const defaultMotion = { current: createUniverseMotion(defaultState.selectedDestination) };

export const IntelligenceUniverseContext = createContext<IntelligenceUniverseContextValue>({
  state: defaultState,
  enabled: false,
  shellVisible: false,
  controlsVisible: false,
  routeIsCompatible: false,
  motion: defaultMotion,
  setEnabled: () => undefined,
  travel: () => undefined,
  setQuality: () => undefined,
  suppressBackdrop: () => false
});

export function useIntelligenceUniverse() {
  return useContext(IntelligenceUniverseContext);
}
