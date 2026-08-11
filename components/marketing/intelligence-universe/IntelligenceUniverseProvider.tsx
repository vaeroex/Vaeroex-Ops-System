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
  INTELLIGENCE_UNIVERSE_RAIL_ANCHORS,
  INTELLIGENCE_UNIVERSE_ROUTES,
  adjacentUniverseSystem,
  clampUniverseRailProgress,
  createUniverseMotion,
  initialUniverseState,
  isUniverseSystemDestination,
  nearestUniverseSystem,
  universeDestinationForPathname,
  universeLevelForDestination,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";

const EXPERIMENT_SESSION_KEY = "vaeroex-intelligence-universe-prototype";

type UniverseAction =
  | { type: "route_sync"; destination: IntelligenceUniverseDestination; preserveSelection: boolean }
  | { type: "travel"; destination: IntelligenceUniverseDestination }
  | { type: "settle" }
  | { type: "select"; destination: IntelligenceUniverseSystemDestination }
  | { type: "reduced_motion"; value: boolean }
  | { type: "quality"; value: IntelligenceUniverseState["quality"] };

function reducer(state: IntelligenceUniverseState, action: UniverseAction): IntelligenceUniverseState {
  if (action.type === "travel") {
    return {
      ...state,
      target: action.destination,
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
    const selectedSystem = productDestination && !action.preserveSelection
      ? productDestination
      : state.selectedSystem;
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
      assetReadiness: { ...state.assetReadiness, [action.destination]: "approach" }
    };
  }

  if (action.type === "reduced_motion") return { ...state, reducedMotion: action.value };
  return { ...state, quality: action.value };
}

function damp(current: number, target: number, smoothing: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * delta));
}

function springRail(motion: IntelligenceUniverseMotion, delta: number, spring = 24, drag = 9.5) {
  motion.velocity += (motion.railTarget - motion.railProgress) * spring * delta;
  motion.velocity *= Math.exp(-drag * delta);
  motion.railProgress = clampUniverseRailProgress(motion.railProgress + motion.velocity * delta);
}

export function IntelligenceUniverseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, pathname, initialUniverseState);
  const [enabled, setEnabledState] = useState(true);
  const [nearTop, setNearTop] = useState(true);
  const travelTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const wheelSettleTimer = useRef<number | null>(null);
  const internalTravelTarget = useRef<IntelligenceUniverseDestination | null>(null);
  const selectedSystemRef = useRef(state.selectedSystem);
  const initialDestination = universeDestinationForPathname(pathname);
  const motion = useRef<IntelligenceUniverseMotion>(createUniverseMotion(
    isUniverseSystemDestination(initialDestination || "vaeroex")
      ? initialDestination as IntelligenceUniverseSystemDestination
      : state.selectedSystem,
    isUniverseSystemDestination(initialDestination || "vaeroex") ? 0.52 : 0
  ));
  const destination = universeDestinationForPathname(pathname);
  const routeIsCompatible = destination !== null;

  const syncNearestSystem = useCallback(() => {
    const nearest = nearestUniverseSystem(motion.current.railProgress);
    if (nearest === selectedSystemRef.current) return;
    selectedSystemRef.current = nearest;
    dispatch({ type: "select", destination: nearest });
  }, []);

  const configureMotionForDestination = useCallback((nextDestination: IntelligenceUniverseDestination) => {
    const currentMotion = motion.current;
    currentMotion.dragging = false;
    currentMotion.dragOriginX = null;
    currentMotion.dragLastX = null;
    currentMotion.dragLastAt = null;

    if (!isUniverseSystemDestination(nextDestination)) {
      currentMotion.approachTarget = 0;
      currentMotion.railTarget = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[nearestUniverseSystem(currentMotion.railProgress)];
      currentMotion.mode = "retreating";
      currentMotion.travelStage = "overview";
      return;
    }

    const nextRail = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[nextDestination];
    const crossesUniverse = Math.abs(nextRail - currentMotion.railProgress) > 0.18;
    currentMotion.railTarget = nextRail;
    currentMotion.velocity = 0;
    if (crossesUniverse) {
      currentMotion.mode = "fast_travel";
      currentMotion.travelStage = currentMotion.approachProgress > 0.34 ? "pullback" : "crossing";
      currentMotion.approachTarget = 0.12;
    } else {
      currentMotion.mode = "approaching";
      currentMotion.travelStage = "approach";
      currentMotion.approachTarget = 1;
    }
  }, []);

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
    const isInternalTravel = internalTravelTarget.current === destination;
    dispatch({ type: "route_sync", destination, preserveSelection: isInternalTravel });
    setNearTop(true);

    if (!isInternalTravel || motion.current.mode === "idle") {
      configureMotionForDestination(destination);
    }
    if (!isInternalTravel && isUniverseSystemDestination(destination)) {
      selectedSystemRef.current = destination;
      motion.current.railTarget = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[destination];
    }
    internalTravelTarget.current = null;

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(
      () => dispatch({ type: "settle" }),
      isUniverseSystemDestination(destination) ? (state.reducedMotion ? 80 : 1650) : 0
    );
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, [configureMotionForDestination, destination, state.reducedMotion]);

  useEffect(() => {
    if (!routeIsCompatible || (destination !== "vaeroex" && destination !== "intelligence-systems")) return;
    const update = () => setNearTop(window.scrollY < window.innerHeight * 0.72);
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
    if (!shellVisible) return;
    let animationFrame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const currentMotion = motion.current;
      const delta = Math.min(0.034, Math.max(0.001, (now - previous) / 1000));
      previous = now;

      if (!currentMotion.dragging) {
        if (currentMotion.mode === "fast_travel") {
          if (currentMotion.travelStage === "pullback") {
            currentMotion.approachTarget = 0.12;
            if (currentMotion.approachProgress < 0.23) currentMotion.travelStage = "crossing";
          } else if (currentMotion.travelStage === "crossing") {
            springRail(currentMotion, delta, 18, 7.2);
            if (
              Math.abs(currentMotion.railTarget - currentMotion.railProgress) < 0.055
              && Math.abs(currentMotion.velocity) < 0.08
            ) {
              currentMotion.railProgress = currentMotion.railTarget;
              currentMotion.velocity = 0;
              currentMotion.travelStage = "approach";
              currentMotion.approachTarget = 1;
            }
          } else {
            springRail(currentMotion, delta);
          }
        } else if (currentMotion.mode !== "idle") {
          springRail(currentMotion, delta);
        }
      }

      const approachSmoothing = currentMotion.mode === "retreating" ? 4.2 : 3.1;
      currentMotion.approachProgress = damp(
        currentMotion.approachProgress,
        currentMotion.approachTarget,
        approachSmoothing,
        delta
      );
      currentMotion.approachProgress = Math.min(1, Math.max(0, currentMotion.approachProgress));
      syncNearestSystem();

      const railSettled = Math.abs(currentMotion.railTarget - currentMotion.railProgress) < 0.0025
        && Math.abs(currentMotion.velocity) < 0.008;
      const approachSettled = Math.abs(currentMotion.approachTarget - currentMotion.approachProgress) < 0.004;
      if (!currentMotion.dragging && railSettled && approachSettled) {
        currentMotion.railProgress = currentMotion.railTarget;
        currentMotion.velocity = 0;
        currentMotion.approachProgress = currentMotion.approachTarget;
        currentMotion.mode = "idle";
      }

      document.documentElement.dataset.intelligenceUniverseRail = currentMotion.railProgress.toFixed(4);
      document.documentElement.dataset.intelligenceUniverseApproach = currentMotion.approachProgress.toFixed(4);
      document.documentElement.dataset.intelligenceUniverseMotion = currentMotion.mode;
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [shellVisible, syncNearestSystem]);

  useEffect(() => {
    document.documentElement.dataset.intelligenceUniverse = shellVisible ? "active" : "inactive";
    document.documentElement.dataset.intelligenceUniverseDestination = state.target;
    document.documentElement.dataset.intelligenceUniversePhase = state.phase;
    return () => {
      delete document.documentElement.dataset.intelligenceUniverse;
      delete document.documentElement.dataset.intelligenceUniverseDestination;
      delete document.documentElement.dataset.intelligenceUniversePhase;
      delete document.documentElement.dataset.intelligenceUniverseRail;
      delete document.documentElement.dataset.intelligenceUniverseApproach;
      delete document.documentElement.dataset.intelligenceUniverseMotion;
    };
  }, [shellVisible, state.phase, state.target]);

  useEffect(() => () => {
    if (travelTimer.current) window.clearTimeout(travelTimer.current);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    if (wheelSettleTimer.current) window.clearTimeout(wheelSettleTimer.current);
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
    internalTravelTarget.current = nextDestination;
    configureMotionForDestination(nextDestination);
    dispatch({ type: "travel", destination: nextDestination });

    const currentMotion = motion.current;
    const delay = isUniverseSystemDestination(nextDestination)
      ? currentMotion.travelStage === "pullback" || currentMotion.travelStage === "crossing" ? 1050 : 520
      : 880;
    travelTimer.current = window.setTimeout(() => router.push(nextRoute), delay);
  }, [configureMotionForDestination, enabled, routeIsCompatible, router, state.reducedMotion]);

  const selectSystem = useCallback((nextDestination: IntelligenceUniverseSystemDestination) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    currentMotion.railTarget = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[nextDestination];
    currentMotion.velocity = 0;
    currentMotion.mode = "settling";
    currentMotion.travelStage = "overview";
  }, [state.inputLocked]);

  const selectAdjacentSystem = useCallback((direction: -1 | 1) => {
    if (state.inputLocked) return;
    selectSystem(adjacentUniverseSystem(nearestUniverseSystem(motion.current.railProgress), direction));
  }, [selectSystem, state.inputLocked]);

  const beginRailDrag = useCallback((clientX: number, at: number) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    currentMotion.dragging = true;
    currentMotion.dragOriginX = clientX;
    currentMotion.dragLastX = clientX;
    currentMotion.dragLastAt = at;
    currentMotion.velocity = 0;
    currentMotion.mode = "dragging";
    currentMotion.travelStage = "overview";
    currentMotion.approachTarget = 0;
  }, [state.inputLocked]);

  const updateRailDrag = useCallback((clientX: number, at: number, viewportWidth: number) => {
    const currentMotion = motion.current;
    if (!currentMotion.dragging || currentMotion.dragLastX === null || currentMotion.dragLastAt === null) return;
    const elapsed = Math.max(8, at - currentMotion.dragLastAt) / 1000;
    const delta = -(clientX - currentMotion.dragLastX) * 2.45 / Math.max(320, viewportWidth);
    const instantVelocity = delta / elapsed;
    currentMotion.railProgress = clampUniverseRailProgress(currentMotion.railProgress + delta);
    currentMotion.railTarget = currentMotion.railProgress;
    currentMotion.velocity = currentMotion.velocity * 0.56 + instantVelocity * 0.44;
    currentMotion.dragLastX = clientX;
    currentMotion.dragLastAt = at;
    if (currentMotion.dragOriginX !== null && Math.abs(clientX - currentMotion.dragOriginX) > 7) {
      currentMotion.suppressClickUntil = at + 260;
    }
    syncNearestSystem();
  }, [syncNearestSystem]);

  const settleRail = useCallback(() => {
    const currentMotion = motion.current;
    const projected = clampUniverseRailProgress(currentMotion.railProgress + currentMotion.velocity * 0.11);
    const nearest = nearestUniverseSystem(projected);
    currentMotion.dragging = false;
    currentMotion.dragOriginX = null;
    currentMotion.dragLastX = null;
    currentMotion.dragLastAt = null;
    currentMotion.railTarget = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[nearest];
    currentMotion.mode = "settling";
    currentMotion.travelStage = "overview";
  }, []);

  const endRailDrag = useCallback((at: number) => {
    if (!motion.current.dragging) return;
    const moved = motion.current.dragOriginX !== null
      && motion.current.dragLastX !== null
      && Math.abs(motion.current.dragLastX - motion.current.dragOriginX) > 7;
    if (moved) {
      motion.current.suppressClickUntil = Math.max(motion.current.suppressClickUntil, at + 120);
    }
    settleRail();
  }, [settleRail]);

  const moveRailBy = useCallback((delta: number) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    currentMotion.railProgress = clampUniverseRailProgress(currentMotion.railProgress + delta);
    currentMotion.railTarget = currentMotion.railProgress;
    currentMotion.velocity = delta * 8;
    currentMotion.mode = "dragging";
    currentMotion.travelStage = "overview";
    currentMotion.approachTarget = 0;
    syncNearestSystem();
    if (wheelSettleTimer.current) window.clearTimeout(wheelSettleTimer.current);
    wheelSettleTimer.current = window.setTimeout(settleRail, 110);
  }, [settleRail, state.inputLocked, syncNearestSystem]);

  const enterSystem = useCallback((nextDestination: IntelligenceUniverseSystemDestination) => {
    if (performance.now() < motion.current.suppressClickUntil) return;
    travel(nextDestination);
  }, [travel]);

  const enterSelectedSystem = useCallback(
    () => enterSystem(state.selectedSystem),
    [enterSystem, state.selectedSystem]
  );

  const setQuality = useCallback((quality: IntelligenceUniverseState["quality"]) => {
    dispatch({ type: "quality", value: quality });
  }, []);

  const value = useMemo<IntelligenceUniverseContextValue>(() => ({
    state,
    enabled,
    shellVisible,
    routeIsCompatible,
    motion,
    setEnabled,
    travel,
    selectSystem,
    selectAdjacentSystem,
    enterSelectedSystem,
    enterSystem,
    beginRailDrag,
    updateRailDrag,
    endRailDrag,
    moveRailBy,
    settleRail,
    setQuality,
    suppressBackdrop: (backdropDestination) => shellVisible && destination === backdropDestination
  }), [
    beginRailDrag,
    destination,
    enabled,
    endRailDrag,
    enterSelectedSystem,
    enterSystem,
    moveRailBy,
    routeIsCompatible,
    selectAdjacentSystem,
    selectSystem,
    setEnabled,
    setQuality,
    settleRail,
    shellVisible,
    state,
    travel,
    updateRailDrag
  ]);

  return (
    <IntelligenceUniverseContext.Provider value={value}>
      <IntelligenceUniverseShell />
      {children}
    </IntelligenceUniverseContext.Provider>
  );
}
