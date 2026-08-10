"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  IntelligenceUniverseContext,
  type IntelligenceUniverseContextValue
} from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";
import { IntelligenceUniverseShell } from "@/components/marketing/intelligence-universe/IntelligenceUniverseShell";
import {
  INTELLIGENCE_UNIVERSE_ROUTES,
  adjacentUniverseSystem,
  initialUniverseState,
  isUniverseSystemDestination,
  universeDestinationForPathname,
  universeLevelForDestination,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";

const EXPERIMENT_SESSION_KEY = "vaeroex-intelligence-universe-prototype";

type UniverseAction =
  | { type: "route_sync"; destination: IntelligenceUniverseDestination }
  | { type: "travel"; destination: IntelligenceUniverseDestination }
  | { type: "settle" }
  | { type: "select"; destination: IntelligenceUniverseSystemDestination }
  | { type: "reduced_motion"; value: boolean }
  | { type: "quality"; value: IntelligenceUniverseState["quality"] };

function reducer(state: IntelligenceUniverseState, action: UniverseAction): IntelligenceUniverseState {
  if (action.type === "travel") {
    const selectedSystem = isUniverseSystemDestination(action.destination) ? action.destination : state.selectedSystem;
    return {
      ...state,
      target: action.destination,
      selectedSystem,
      phase: "transitioning",
      level: isUniverseSystemDestination(action.destination) ? "approach" : universeLevelForDestination(action.destination, "idle"),
      inputLocked: true,
      assetReadiness: isUniverseSystemDestination(action.destination)
        ? { ...state.assetReadiness, [action.destination]: "approach" }
        : state.assetReadiness
    };
  }

  if (action.type === "route_sync") {
    const productDestination = isUniverseSystemDestination(action.destination) ? action.destination : null;
    const selectedSystem = productDestination || state.selectedSystem;
    const phase = productDestination ? "arriving" : "idle";
    return {
      ...state,
      current: action.destination,
      target: action.destination,
      selectedSystem,
      route: INTELLIGENCE_UNIVERSE_ROUTES[action.destination],
      phase,
      level: universeLevelForDestination(action.destination, phase),
      inputLocked: Boolean(productDestination),
      assetReadiness: productDestination
        ? { ...state.assetReadiness, [productDestination]: "approach" }
        : state.assetReadiness
    };
  }

  if (action.type === "settle") {
    const productDestination = isUniverseSystemDestination(state.target) ? state.target : null;
    return {
      ...state,
      current: state.target,
      phase: productDestination ? "deep" : "idle",
      level: universeLevelForDestination(state.target, productDestination ? "deep" : "idle"),
      inputLocked: false,
      assetReadiness: productDestination
        ? { ...state.assetReadiness, [productDestination]: "detail" }
        : state.assetReadiness
    };
  }

  if (action.type === "select") {
    return {
      ...state,
      selectedSystem: action.destination,
      target: action.destination,
      assetReadiness: { ...state.assetReadiness, [action.destination]: "approach" }
    };
  }

  if (action.type === "reduced_motion") return { ...state, reducedMotion: action.value };
  return { ...state, quality: action.value };
}

export function IntelligenceUniverseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, pathname, initialUniverseState);
  const [enabled, setEnabledState] = useState(true);
  const [nearTop, setNearTop] = useState(true);
  const travelTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const destination = universeDestinationForPathname(pathname);
  const routeIsCompatible = destination !== null;

  useEffect(() => {
    const stored = window.sessionStorage.getItem(EXPERIMENT_SESSION_KEY);
    if (stored === "classic") setEnabledState(false);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => dispatch({ type: "reduced_motion", value: media.matches });
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!destination) return;
    dispatch({ type: "route_sync", destination });
    setNearTop(true);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(
      () => dispatch({ type: "settle" }),
      isUniverseSystemDestination(destination) ? (state.reducedMotion ? 80 : 920) : 0
    );
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, [destination, state.reducedMotion]);

  useEffect(() => {
    if (!routeIsCompatible || (destination !== "vaeroex" && destination !== "intelligence-systems")) return;
    const update = () => setNearTop(window.scrollY < window.innerHeight * 0.62);
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [destination, routeIsCompatible]);

  const shellVisible = enabled && routeIsCompatible && (
    state.phase === "transitioning"
    || state.phase === "arriving"
    || ((destination === "vaeroex" || destination === "intelligence-systems") && nearTop)
  );

  useEffect(() => {
    document.documentElement.dataset.intelligenceUniverse = shellVisible ? "active" : "inactive";
    document.documentElement.dataset.intelligenceUniverseDestination = state.target;
    document.documentElement.dataset.intelligenceUniversePhase = state.phase;
    return () => {
      delete document.documentElement.dataset.intelligenceUniverse;
      delete document.documentElement.dataset.intelligenceUniverseDestination;
      delete document.documentElement.dataset.intelligenceUniversePhase;
    };
  }, [shellVisible, state.phase, state.target]);

  useEffect(() => () => {
    if (travelTimer.current) window.clearTimeout(travelTimer.current);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    window.sessionStorage.setItem(EXPERIMENT_SESSION_KEY, nextEnabled ? "spatial" : "classic");
  }, []);

  const travel = useCallback((nextDestination: IntelligenceUniverseDestination) => {
    const nextRoute = INTELLIGENCE_UNIVERSE_ROUTES[nextDestination];
    if (!enabled || !routeIsCompatible || state.reducedMotion) {
      router.push(nextRoute);
      return;
    }

    if (travelTimer.current) window.clearTimeout(travelTimer.current);
    dispatch({ type: "travel", destination: nextDestination });
    travelTimer.current = window.setTimeout(() => router.push(nextRoute), 460);
  }, [enabled, routeIsCompatible, router, state.reducedMotion]);

  const selectSystem = useCallback((nextDestination: IntelligenceUniverseSystemDestination) => {
    if (state.inputLocked) return;
    dispatch({ type: "select", destination: nextDestination });
  }, [state.inputLocked]);

  const selectAdjacentSystem = useCallback((direction: -1 | 1) => {
    if (state.inputLocked) return;
    dispatch({ type: "select", destination: adjacentUniverseSystem(state.selectedSystem, direction) });
  }, [state.inputLocked, state.selectedSystem]);

  const enterSelectedSystem = useCallback(() => travel(state.selectedSystem), [state.selectedSystem, travel]);
  const setQuality = useCallback((quality: IntelligenceUniverseState["quality"]) => {
    dispatch({ type: "quality", value: quality });
  }, []);

  const value = useMemo<IntelligenceUniverseContextValue>(() => ({
    state,
    enabled,
    shellVisible,
    routeIsCompatible,
    setEnabled,
    travel,
    selectSystem,
    selectAdjacentSystem,
    enterSelectedSystem,
    setQuality,
    suppressBackdrop: (backdropDestination) => shellVisible && destination === backdropDestination
  }), [
    destination,
    enabled,
    enterSelectedSystem,
    routeIsCompatible,
    selectAdjacentSystem,
    selectSystem,
    setEnabled,
    setQuality,
    shellVisible,
    state,
    travel
  ]);

  return (
    <IntelligenceUniverseContext.Provider value={value}>
      <IntelligenceUniverseShell />
      {children}
    </IntelligenceUniverseContext.Provider>
  );
}
