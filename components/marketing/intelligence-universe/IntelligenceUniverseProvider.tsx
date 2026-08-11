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
  INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS,
  INTELLIGENCE_UNIVERSE_MAP_EXTENTS,
  INTELLIGENCE_UNIVERSE_ROUTES,
  createUniverseMotion,
  distanceBetweenUniversePoints,
  initialUniverseState,
  isUniverseSystemDestination,
  sampleGuidedUniverseJourney,
  universeDestinationForPathname,
  universeLevelForDestination,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseProximity,
  type IntelligenceUniverseState,
  type IntelligenceUniverseVector3
} from "@/lib/marketing/intelligence-universe";

const EXPERIMENT_SESSION_KEY = "vaeroex-intelligence-universe-prototype";

type UniverseAction =
  | { type: "route_sync"; destination: IntelligenceUniverseDestination; preserveSelection: boolean }
  | { type: "travel"; destination: IntelligenceUniverseDestination }
  | { type: "settle" }
  | { type: "focus"; destination: IntelligenceUniverseDestination; proximity: IntelligenceUniverseProximity }
  | { type: "reduced_motion"; value: boolean }
  | { type: "quality"; value: IntelligenceUniverseState["quality"] };

function reducer(state: IntelligenceUniverseState, action: UniverseAction): IntelligenceUniverseState {
  if (action.type === "travel") {
    const productDestination = isUniverseSystemDestination(action.destination) ? action.destination : null;
    return {
      ...state,
      target: action.destination,
      selectedDestination: action.destination,
      selectedSystem: productDestination || state.selectedSystem,
      proximity: "signal",
      phase: "transitioning",
      level: universeLevelForDestination(action.destination, "arriving"),
      inputLocked: true,
      assetReadiness: productDestination
        ? { ...state.assetReadiness, [productDestination]: "approach" }
        : state.assetReadiness
    };
  }

  if (action.type === "route_sync") {
    const productDestination = isUniverseSystemDestination(action.destination) ? action.destination : null;
    const selectedSystem = productDestination && !action.preserveSelection
      ? productDestination
      : state.selectedSystem;
    const phase = action.destination === "vaeroex" ? "idle" : "arriving";
    return {
      ...state,
      current: action.destination,
      target: action.destination,
      selectedDestination: action.preserveSelection ? state.selectedDestination : action.destination,
      selectedSystem,
      proximity: action.destination === "vaeroex" ? "signal" : "near",
      route: INTELLIGENCE_UNIVERSE_ROUTES[action.destination],
      phase,
      level: universeLevelForDestination(action.destination, phase),
      inputLocked: action.destination !== "vaeroex",
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

  if (action.type === "focus") {
    if (state.selectedDestination === action.destination && state.proximity === action.proximity) return state;
    const productDestination = isUniverseSystemDestination(action.destination) ? action.destination : null;
    return {
      ...state,
      selectedDestination: action.destination,
      selectedSystem: productDestination || state.selectedSystem,
      proximity: action.proximity,
      assetReadiness: productDestination
        ? { ...state.assetReadiness, [productDestination]: "approach" }
        : state.assetReadiness
    };
  }

  if (action.type === "reduced_motion") return { ...state, reducedMotion: action.value };
  return { ...state, quality: action.value };
}

function damp(current: number, target: number, smoothing: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * delta));
}

function copyPosition(target: IntelligenceUniverseVector3, source: Readonly<IntelligenceUniverseVector3>) {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function dampPosition(
  target: IntelligenceUniverseVector3,
  destination: Readonly<IntelligenceUniverseVector3>,
  smoothing: number,
  delta: number
) {
  target.x = damp(target.x, destination.x, smoothing, delta);
  target.y = damp(target.y, destination.y, smoothing, delta);
  target.z = damp(target.z, destination.z, smoothing, delta);
}

function journeySelector(destination: IntelligenceUniverseDestination) {
  if (destination === "vaeroex") return "[data-public-spatial-journey]";
  if (destination === "intelligence-systems") return "[data-intelligence-systems-journey]";
  return ".vaeroex-public-site";
}

export function IntelligenceUniverseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, pathname, initialUniverseState);
  const [enabled, setEnabledState] = useState(true);
  const [nearTop, setNearTop] = useState(true);
  const travelTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const internalTravelTarget = useRef<IntelligenceUniverseDestination | null>(null);
  const selectedDestinationRef = useRef(state.selectedDestination);
  const proximityRef = useRef(state.proximity);
  const initialDestination = universeDestinationForPathname(pathname);
  const motion = useRef<IntelligenceUniverseMotion>(createUniverseMotion(
    initialDestination || "vaeroex",
    initialDestination && initialDestination !== "vaeroex" ? 0.52 : 0
  ));
  const destination = universeDestinationForPathname(pathname);
  const routeIsCompatible = destination !== null;

  const syncGuidedFocus = useCallback((nextDestination: IntelligenceUniverseDestination, proximity: IntelligenceUniverseProximity) => {
    if (selectedDestinationRef.current === nextDestination && proximityRef.current === proximity) return;
    selectedDestinationRef.current = nextDestination;
    proximityRef.current = proximity;
    dispatch({ type: "focus", destination: nextDestination, proximity });
  }, []);

  const configureMotionForDestination = useCallback((nextDestination: IntelligenceUniverseDestination) => {
    const currentMotion = motion.current;
    selectedDestinationRef.current = nextDestination;
    proximityRef.current = "signal";
    currentMotion.scrollTarget = 0;
    const nextPosition = INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[nextDestination];
    const crossesUniverse = distanceBetweenUniversePoints(currentMotion.position, nextPosition) > 2.5;
    copyPosition(currentMotion.targetPosition, nextPosition);
    if (crossesUniverse) {
      currentMotion.mode = "fast_travel";
      currentMotion.travelStage = currentMotion.approachProgress > 0.24 ? "pullback" : "crossing";
      currentMotion.approachTarget = 0.06;
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
    if (!isInternalTravel) {
      selectedDestinationRef.current = destination;
      proximityRef.current = destination === "vaeroex" ? "signal" : "near";
    }
    internalTravelTarget.current = null;

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(
      () => dispatch({ type: "settle" }),
      destination === "vaeroex"
        ? 0
        : (state.reducedMotion ? 100 : isInternalTravel ? 680 : 1080)
    );
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, [configureMotionForDestination, destination, state.reducedMotion]);

  useEffect(() => {
    if (!destination) return;
    const update = () => {
      const journey = document.querySelector<HTMLElement>(journeySelector(destination));
      const travel = journey ? Math.max(1, journey.offsetHeight - window.innerHeight) : 1;
      const bounds = journey?.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, bounds ? -bounds.top / travel : 0));
      motion.current.scrollTarget = progress;
      setNearTop(window.scrollY < window.innerHeight * 0.72);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [destination]);

  const persistentJourney = destination === "vaeroex" || destination === "intelligence-systems";
  const shellVisible = enabled && routeIsCompatible && (
    state.phase === "transitioning"
    || state.phase === "arriving"
    || persistentJourney
    || (!isUniverseSystemDestination(destination || "vaeroex") && nearTop)
  );
  const controlsVisible = shellVisible && (
    state.phase === "transitioning"
    || state.phase === "arriving"
    || nearTop
  );

  useEffect(() => {
    if (!shellVisible || !destination) return;
    let animationFrame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const currentMotion = motion.current;
      const delta = Math.min(0.034, Math.max(0.001, (now - previous) / 1000));
      previous = now;

      currentMotion.scrollProgress = state.reducedMotion
        ? currentMotion.scrollTarget
        : damp(currentMotion.scrollProgress, currentMotion.scrollTarget, 4.2, delta);

      if (currentMotion.mode === "fast_travel") {
        if (currentMotion.travelStage === "pullback") {
          currentMotion.approachTarget = 0.06;
          if (currentMotion.approachProgress < 0.14) currentMotion.travelStage = "crossing";
        } else if (currentMotion.travelStage === "crossing") {
          dampPosition(currentMotion.position, currentMotion.targetPosition, 5.8, delta);
          if (distanceBetweenUniversePoints(currentMotion.position, currentMotion.targetPosition) < 1.25) {
            currentMotion.travelStage = "approach";
            currentMotion.approachTarget = 1;
          }
        } else {
          dampPosition(currentMotion.position, currentMotion.targetPosition, 6.4, delta);
        }
      } else if (currentMotion.mode === "approaching" || currentMotion.mode === "retreating") {
        dampPosition(currentMotion.position, currentMotion.targetPosition, currentMotion.mode === "retreating" ? 5 : 6.2, delta);
      } else {
        const frame = sampleGuidedUniverseJourney(destination, currentMotion.scrollProgress);
        copyPosition(currentMotion.targetPosition, frame.position);
        currentMotion.approachTarget = frame.approach;
        currentMotion.mode = "scrolling";
        dampPosition(currentMotion.position, currentMotion.targetPosition, 4.8, delta);
        syncGuidedFocus(frame.focus, frame.approach > 0.42 ? "near" : "signal");
      }

      currentMotion.approachProgress = state.reducedMotion
        ? currentMotion.approachTarget
        : damp(currentMotion.approachProgress, currentMotion.approachTarget, 5.4, delta);
      currentMotion.approachProgress = Math.min(1, Math.max(0, currentMotion.approachProgress));

      const positionSettled = distanceBetweenUniversePoints(currentMotion.position, currentMotion.targetPosition) < 0.055;
      const approachSettled = Math.abs(currentMotion.approachTarget - currentMotion.approachProgress) < 0.004;
      const scrollSettled = Math.abs(currentMotion.scrollTarget - currentMotion.scrollProgress) < 0.0015;
      if (positionSettled && approachSettled) {
        if (currentMotion.mode === "fast_travel" && currentMotion.travelStage === "approach") {
          currentMotion.mode = "idle";
        } else if (currentMotion.mode === "approaching" || currentMotion.mode === "retreating") {
          currentMotion.mode = "idle";
        } else if (currentMotion.mode === "scrolling" && scrollSettled) {
          currentMotion.mode = "idle";
        }
      }

      const root = document.documentElement;
      const normalizedX = (currentMotion.position.x - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[0])
        / (INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[1] - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.x[0]);
      const normalizedY = 1 - (currentMotion.position.y - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[0])
        / (INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[1] - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.y[0]);
      const normalizedZ = (currentMotion.position.z - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.z[0])
        / (INTELLIGENCE_UNIVERSE_MAP_EXTENTS.z[1] - INTELLIGENCE_UNIVERSE_MAP_EXTENTS.z[0]);
      root.dataset.intelligenceUniverseX = currentMotion.position.x.toFixed(3);
      root.dataset.intelligenceUniverseY = currentMotion.position.y.toFixed(3);
      root.dataset.intelligenceUniverseZ = currentMotion.position.z.toFixed(3);
      root.dataset.intelligenceUniverseApproach = currentMotion.approachProgress.toFixed(4);
      root.dataset.intelligenceUniverseScroll = currentMotion.scrollProgress.toFixed(4);
      root.dataset.intelligenceUniverseMotion = currentMotion.mode;
      root.dataset.intelligenceUniverseProximity = proximityRef.current;
      root.style.setProperty("--intelligence-universe-map-x", `${(normalizedX * 100).toFixed(2)}%`);
      root.style.setProperty("--intelligence-universe-map-y", `${(normalizedY * 100).toFixed(2)}%`);
      root.style.setProperty("--intelligence-universe-map-depth", normalizedZ.toFixed(3));
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [destination, shellVisible, state.reducedMotion, syncGuidedFocus]);

  useEffect(() => {
    document.documentElement.dataset.intelligenceUniverse = shellVisible ? "active" : "inactive";
    document.documentElement.dataset.intelligenceUniverseDestination = state.target;
    document.documentElement.dataset.intelligenceUniversePhase = state.phase;
    return () => {
      const root = document.documentElement;
      delete root.dataset.intelligenceUniverse;
      delete root.dataset.intelligenceUniverseDestination;
      delete root.dataset.intelligenceUniversePhase;
      delete root.dataset.intelligenceUniverseX;
      delete root.dataset.intelligenceUniverseY;
      delete root.dataset.intelligenceUniverseZ;
      delete root.dataset.intelligenceUniverseApproach;
      delete root.dataset.intelligenceUniverseScroll;
      delete root.dataset.intelligenceUniverseMotion;
      delete root.dataset.intelligenceUniverseProximity;
      root.style.removeProperty("--intelligence-universe-map-x");
      root.style.removeProperty("--intelligence-universe-map-y");
      root.style.removeProperty("--intelligence-universe-map-depth");
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
    if (!enabled || !routeIsCompatible) {
      router.push(nextRoute);
      return;
    }

    if (travelTimer.current) window.clearTimeout(travelTimer.current);
    internalTravelTarget.current = nextDestination;
    selectedDestinationRef.current = nextDestination;
    proximityRef.current = "signal";
    dispatch({ type: "travel", destination: nextDestination });

    if (state.reducedMotion) {
      travelTimer.current = window.setTimeout(() => router.push(nextRoute), 140);
      return;
    }

    configureMotionForDestination(nextDestination);
    travelTimer.current = window.setTimeout(() => router.push(nextRoute), 1120);
  }, [configureMotionForDestination, enabled, routeIsCompatible, router, state.reducedMotion]);

  const setQuality = useCallback((quality: IntelligenceUniverseState["quality"]) => {
    dispatch({ type: "quality", value: quality });
  }, []);

  const value = useMemo<IntelligenceUniverseContextValue>(() => ({
    state,
    enabled,
    shellVisible,
    controlsVisible,
    routeIsCompatible,
    motion,
    setEnabled,
    travel,
    setQuality,
    suppressBackdrop: (backdropDestination) => shellVisible && destination === backdropDestination
  }), [
    controlsVisible,
    destination,
    enabled,
    routeIsCompatible,
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
