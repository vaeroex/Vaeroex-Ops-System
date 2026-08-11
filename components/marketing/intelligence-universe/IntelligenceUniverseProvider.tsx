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
  INTELLIGENCE_UNIVERSE_BOUNDS,
  INTELLIGENCE_UNIVERSE_ROUTES,
  adjacentUniverseSystem,
  clampUniversePosition,
  createUniverseMotion,
  distanceBetweenUniversePoints,
  distanceToUniverseSystem,
  initialUniverseState,
  isUniverseSystemDestination,
  moveUniversePosition,
  nearestUniverseSystem,
  universeDestinationForPathname,
  universeLevelForDestination,
  universeProximityForDistance,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseProximity,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination,
  type IntelligenceUniverseVector3
} from "@/lib/marketing/intelligence-universe";

const EXPERIMENT_SESSION_KEY = "vaeroex-intelligence-universe-prototype";

type UniverseAction =
  | { type: "route_sync"; destination: IntelligenceUniverseDestination; preserveSelection: boolean }
  | { type: "travel"; destination: IntelligenceUniverseDestination }
  | { type: "settle" }
  | { type: "locate"; destination: IntelligenceUniverseSystemDestination; proximity: IntelligenceUniverseProximity }
  | { type: "reduced_motion"; value: boolean }
  | { type: "quality"; value: IntelligenceUniverseState["quality"] };

function reducer(state: IntelligenceUniverseState, action: UniverseAction): IntelligenceUniverseState {
  if (action.type === "travel") {
    const productDestination = isUniverseSystemDestination(action.destination) ? action.destination : null;
    return {
      ...state,
      target: action.destination,
      selectedSystem: productDestination || state.selectedSystem,
      proximity: productDestination ? "signal" : state.proximity,
      phase: "transitioning",
      level: productDestination ? "approach" : universeLevelForDestination(action.destination, "idle"),
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
    const phase = productDestination ? "arriving" : "idle";
    return {
      ...state,
      current: action.destination,
      target: action.destination,
      selectedSystem,
      proximity: productDestination ? "near" : state.proximity,
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

  if (action.type === "locate") {
    if (state.selectedSystem === action.destination && state.proximity === action.proximity) return state;
    return {
      ...state,
      selectedSystem: action.destination,
      proximity: action.proximity,
      assetReadiness: action.proximity === "open_field"
        ? state.assetReadiness
        : { ...state.assetReadiness, [action.destination]: "approach" }
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

function zeroVelocity(motion: IntelligenceUniverseMotion) {
  motion.velocity.x = 0;
  motion.velocity.y = 0;
  motion.velocity.z = 0;
}

function velocityMagnitude(motion: IntelligenceUniverseMotion) {
  return Math.hypot(motion.velocity.x, motion.velocity.y, motion.velocity.z);
}

function springPosition(motion: IntelligenceUniverseMotion, delta: number, spring = 25, drag = 8.8) {
  for (const axis of ["x", "y", "z"] as const) {
    motion.velocity[axis] += (motion.targetPosition[axis] - motion.position[axis]) * spring * delta;
    motion.velocity[axis] *= Math.exp(-drag * delta);
    motion.position[axis] += motion.velocity[axis] * delta;
  }
  const bounded = clampUniversePosition(motion.position);
  copyPosition(motion.position, bounded);
}

function integrateFreeMotion(motion: IntelligenceUniverseMotion, delta: number) {
  const nearest = nearestUniverseSystem(motion.position);
  const gravityTarget = INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[nearest];
  const direction = {
    x: gravityTarget.x - motion.position.x,
    y: gravityTarget.y - motion.position.y,
    z: gravityTarget.z - motion.position.z
  };
  const distance = Math.max(0.001, Math.hypot(direction.x, direction.y, direction.z));
  const headingToward = (
    motion.velocity.x * direction.x
    + motion.velocity.y * direction.y
    + motion.velocity.z * direction.z
  ) / distance;

  if (distance < 38 && headingToward > 0.08) {
    const attraction = (1 - distance / 38) * 0.72 * delta;
    motion.velocity.x += direction.x / distance * attraction;
    motion.velocity.y += direction.y / distance * attraction;
    motion.velocity.z += direction.z / distance * attraction;
  }

  for (const axis of ["x", "y", "z"] as const) {
    const [minimum, maximum] = INTELLIGENCE_UNIVERSE_BOUNDS[axis];
    const boundaryBand = axis === "z" ? 10 : 8;
    if (motion.position[axis] < minimum + boundaryBand) {
      motion.velocity[axis] += (minimum + boundaryBand - motion.position[axis]) * 2.2 * delta;
    } else if (motion.position[axis] > maximum - boundaryBand) {
      motion.velocity[axis] -= (motion.position[axis] - (maximum - boundaryBand)) * 2.2 * delta;
    }
    motion.velocity[axis] *= Math.exp(-2.85 * delta);
    motion.position[axis] += motion.velocity[axis] * delta;
  }

  const bounded = clampUniversePosition(motion.position);
  for (const axis of ["x", "y", "z"] as const) {
    if (bounded[axis] !== motion.position[axis]) motion.velocity[axis] = 0;
  }
  copyPosition(motion.position, bounded);
  copyPosition(motion.targetPosition, bounded);
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
  const selectedSystemRef = useRef(state.selectedSystem);
  const proximityRef = useRef(state.proximity);
  const initialDestination = universeDestinationForPathname(pathname);
  const motion = useRef<IntelligenceUniverseMotion>(createUniverseMotion(
    isUniverseSystemDestination(initialDestination || "vaeroex")
      ? initialDestination as IntelligenceUniverseSystemDestination
      : state.selectedSystem,
    isUniverseSystemDestination(initialDestination || "vaeroex") ? 0.52 : 0
  ));
  const destination = universeDestinationForPathname(pathname);
  const routeIsCompatible = destination !== null;

  const syncSpatialLocation = useCallback(() => {
    const currentMotion = motion.current;
    const assisted = currentMotion.mode === "fast_travel" || currentMotion.mode === "approaching";
    const nearest = assisted ? selectedSystemRef.current : nearestUniverseSystem(currentMotion.position);
    const proximity = universeProximityForDistance(distanceToUniverseSystem(currentMotion.position, nearest));
    if (nearest === selectedSystemRef.current && proximity === proximityRef.current) return;
    selectedSystemRef.current = nearest;
    proximityRef.current = proximity;
    dispatch({ type: "locate", destination: nearest, proximity });
  }, []);

  const configureMotionForDestination = useCallback((nextDestination: IntelligenceUniverseDestination) => {
    const currentMotion = motion.current;
    currentMotion.dragging = false;
    currentMotion.dragOriginX = null;
    currentMotion.dragOriginY = null;
    currentMotion.dragLastX = null;
    currentMotion.dragLastY = null;
    currentMotion.dragLastAt = null;

    if (!isUniverseSystemDestination(nextDestination)) {
      currentMotion.approachTarget = 0;
      copyPosition(currentMotion.targetPosition, currentMotion.position);
      if (currentMotion.approachProgress > 0.015) {
        copyPosition(currentMotion.targetPosition, INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[selectedSystemRef.current]);
        currentMotion.mode = "retreating";
      } else {
        currentMotion.mode = velocityMagnitude(currentMotion) > 0.02 ? "coasting" : "idle";
      }
      currentMotion.travelStage = "overview";
      return;
    }

    selectedSystemRef.current = nextDestination;
    proximityRef.current = "signal";
    const nextPosition = INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[nextDestination];
    const crossesUniverse = distanceBetweenUniversePoints(currentMotion.position, nextPosition) > 2.5;
    copyPosition(currentMotion.targetPosition, nextPosition);
    zeroVelocity(currentMotion);
    if (crossesUniverse) {
      currentMotion.mode = "fast_travel";
      currentMotion.travelStage = currentMotion.approachProgress > 0.24 ? "pullback" : "crossing";
      currentMotion.approachTarget = 0.08;
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
      proximityRef.current = "near";
      copyPosition(motion.current.targetPosition, INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[destination]);
    }
    internalTravelTarget.current = null;

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(
      () => dispatch({ type: "settle" }),
      isUniverseSystemDestination(destination)
        ? (state.reducedMotion ? 80 : isInternalTravel ? 720 : 1180)
        : 0
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
            currentMotion.approachTarget = 0.08;
            if (currentMotion.approachProgress < 0.16) currentMotion.travelStage = "crossing";
          } else if (currentMotion.travelStage === "crossing") {
            springPosition(currentMotion, delta, 29, 8.2);
            if (
              distanceBetweenUniversePoints(currentMotion.position, currentMotion.targetPosition) < 1.8
              && velocityMagnitude(currentMotion) < 2.2
            ) {
              currentMotion.travelStage = "approach";
              currentMotion.approachTarget = 1;
            }
          } else {
            springPosition(currentMotion, delta, 24, 9.2);
          }
        } else if (currentMotion.mode === "settling" || currentMotion.mode === "approaching" || currentMotion.mode === "retreating") {
          springPosition(currentMotion, delta, currentMotion.mode === "retreating" ? 18 : 24, 9.2);
        } else if (currentMotion.mode === "coasting") {
          integrateFreeMotion(currentMotion, delta);
        }
      }

      const approachSmoothing = currentMotion.mode === "retreating" ? 4.8 : 3.8;
      currentMotion.approachProgress = damp(
        currentMotion.approachProgress,
        currentMotion.approachTarget,
        approachSmoothing,
        delta
      );
      currentMotion.approachProgress = Math.min(1, Math.max(0, currentMotion.approachProgress));
      syncSpatialLocation();

      const positionSettled = distanceBetweenUniversePoints(currentMotion.position, currentMotion.targetPosition) < 0.06
        && velocityMagnitude(currentMotion) < 0.045;
      const approachSettled = Math.abs(currentMotion.approachTarget - currentMotion.approachProgress) < 0.004;
      if (!currentMotion.dragging && currentMotion.mode === "coasting" && velocityMagnitude(currentMotion) < 0.018) {
        zeroVelocity(currentMotion);
        currentMotion.mode = "idle";
      } else if (
        !currentMotion.dragging
        && positionSettled
        && approachSettled
        && currentMotion.mode !== "fast_travel"
      ) {
        copyPosition(currentMotion.position, currentMotion.targetPosition);
        zeroVelocity(currentMotion);
        currentMotion.approachProgress = currentMotion.approachTarget;
        currentMotion.mode = "idle";
      }

      const root = document.documentElement;
      const normalizedX = (currentMotion.position.x - INTELLIGENCE_UNIVERSE_BOUNDS.x[0])
        / (INTELLIGENCE_UNIVERSE_BOUNDS.x[1] - INTELLIGENCE_UNIVERSE_BOUNDS.x[0]);
      const normalizedY = 1 - (currentMotion.position.y - INTELLIGENCE_UNIVERSE_BOUNDS.y[0])
        / (INTELLIGENCE_UNIVERSE_BOUNDS.y[1] - INTELLIGENCE_UNIVERSE_BOUNDS.y[0]);
      const normalizedZ = (currentMotion.position.z - INTELLIGENCE_UNIVERSE_BOUNDS.z[0])
        / (INTELLIGENCE_UNIVERSE_BOUNDS.z[1] - INTELLIGENCE_UNIVERSE_BOUNDS.z[0]);
      root.dataset.intelligenceUniverseX = currentMotion.position.x.toFixed(3);
      root.dataset.intelligenceUniverseY = currentMotion.position.y.toFixed(3);
      root.dataset.intelligenceUniverseZ = currentMotion.position.z.toFixed(3);
      root.dataset.intelligenceUniverseApproach = currentMotion.approachProgress.toFixed(4);
      root.dataset.intelligenceUniverseMotion = currentMotion.mode;
      root.dataset.intelligenceUniverseProximity = proximityRef.current;
      root.style.setProperty("--intelligence-universe-map-x", `${(normalizedX * 100).toFixed(2)}%`);
      root.style.setProperty("--intelligence-universe-map-y", `${(normalizedY * 100).toFixed(2)}%`);
      root.style.setProperty("--intelligence-universe-map-depth", normalizedZ.toFixed(3));
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [shellVisible, syncSpatialLocation]);

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
    if (!enabled || !routeIsCompatible || state.reducedMotion) {
      router.push(nextRoute);
      return;
    }

    if (travelTimer.current) window.clearTimeout(travelTimer.current);
    internalTravelTarget.current = nextDestination;
    if (isUniverseSystemDestination(nextDestination)) {
      selectedSystemRef.current = nextDestination;
      proximityRef.current = "signal";
    }
    configureMotionForDestination(nextDestination);
    dispatch({ type: "travel", destination: nextDestination });

    const currentMotion = motion.current;
    const delay = isUniverseSystemDestination(nextDestination)
      ? currentMotion.travelStage === "pullback" || currentMotion.travelStage === "crossing" ? 1280 : 760
      : 880;
    travelTimer.current = window.setTimeout(() => router.push(nextRoute), delay);
  }, [configureMotionForDestination, enabled, routeIsCompatible, router, state.reducedMotion]);

  const selectSystem = useCallback((nextDestination: IntelligenceUniverseSystemDestination) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    selectedSystemRef.current = nextDestination;
    proximityRef.current = "signal";
    dispatch({ type: "locate", destination: nextDestination, proximity: "signal" });
    copyPosition(currentMotion.targetPosition, INTELLIGENCE_UNIVERSE_APPROACH_POSITIONS[nextDestination]);
    zeroVelocity(currentMotion);
    currentMotion.approachTarget = 0;
    currentMotion.mode = "settling";
    currentMotion.travelStage = "overview";
  }, [state.inputLocked]);

  const selectAdjacentSystem = useCallback((direction: -1 | 1) => {
    if (state.inputLocked) return;
    selectSystem(adjacentUniverseSystem(selectedSystemRef.current, direction));
  }, [selectSystem, state.inputLocked]);

  const beginExplorationDrag = useCallback((clientX: number, clientY: number, at: number) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    currentMotion.dragging = true;
    currentMotion.dragOriginX = clientX;
    currentMotion.dragOriginY = clientY;
    currentMotion.dragLastX = clientX;
    currentMotion.dragLastY = clientY;
    currentMotion.dragLastAt = at;
    zeroVelocity(currentMotion);
    copyPosition(currentMotion.targetPosition, currentMotion.position);
    currentMotion.mode = "dragging";
    currentMotion.travelStage = "overview";
    currentMotion.approachTarget = 0;
  }, [state.inputLocked]);

  const updateExplorationDrag = useCallback((
    clientX: number,
    clientY: number,
    at: number,
    viewportWidth: number,
    viewportHeight: number
  ) => {
    const currentMotion = motion.current;
    if (
      !currentMotion.dragging
      || currentMotion.dragLastX === null
      || currentMotion.dragLastY === null
      || currentMotion.dragLastAt === null
    ) return;
    const elapsed = Math.max(8, at - currentMotion.dragLastAt) / 1000;
    const delta: IntelligenceUniverseVector3 = {
      x: -(clientX - currentMotion.dragLastX) * 38 / Math.max(320, viewportWidth),
      y: (clientY - currentMotion.dragLastY) * 26 / Math.max(480, viewportHeight),
      z: 0
    };
    const nextPosition = moveUniversePosition(currentMotion.position, delta);
    currentMotion.velocity.x = Math.min(8, Math.max(
      -8,
      currentMotion.velocity.x * 0.52 + (nextPosition.x - currentMotion.position.x) / elapsed * 0.48
    ));
    currentMotion.velocity.y = Math.min(6, Math.max(
      -6,
      currentMotion.velocity.y * 0.52 + (nextPosition.y - currentMotion.position.y) / elapsed * 0.48
    ));
    currentMotion.velocity.z *= 0.72;
    copyPosition(currentMotion.position, nextPosition);
    copyPosition(currentMotion.targetPosition, nextPosition);
    currentMotion.dragLastX = clientX;
    currentMotion.dragLastY = clientY;
    currentMotion.dragLastAt = at;
    if (
      currentMotion.dragOriginX !== null
      && currentMotion.dragOriginY !== null
      && Math.hypot(clientX - currentMotion.dragOriginX, clientY - currentMotion.dragOriginY) > 7
    ) {
      currentMotion.suppressClickUntil = at + 260;
    }
    syncSpatialLocation();
  }, [syncSpatialLocation]);

  const endExplorationDrag = useCallback((at: number) => {
    const currentMotion = motion.current;
    if (!currentMotion.dragging) return;
    const moved = currentMotion.dragOriginX !== null
      && currentMotion.dragOriginY !== null
      && currentMotion.dragLastX !== null
      && currentMotion.dragLastY !== null
      && Math.hypot(
        currentMotion.dragLastX - currentMotion.dragOriginX,
        currentMotion.dragLastY - currentMotion.dragOriginY
      ) > 7;
    if (moved) currentMotion.suppressClickUntil = Math.max(currentMotion.suppressClickUntil, at + 120);
    currentMotion.dragging = false;
    currentMotion.dragOriginX = null;
    currentMotion.dragOriginY = null;
    currentMotion.dragLastX = null;
    currentMotion.dragLastY = null;
    currentMotion.dragLastAt = null;
    copyPosition(currentMotion.targetPosition, currentMotion.position);
    currentMotion.mode = velocityMagnitude(currentMotion) > 0.02 ? "coasting" : "idle";
    currentMotion.travelStage = "overview";
  }, []);

  const nudgeExploration = useCallback((delta: IntelligenceUniverseVector3) => {
    if (state.inputLocked) return;
    const currentMotion = motion.current;
    const nextPosition = moveUniversePosition(currentMotion.position, delta);
    currentMotion.velocity.x = Math.min(10, Math.max(-10, currentMotion.velocity.x * 0.45 + (nextPosition.x - currentMotion.position.x) * 4.2));
    currentMotion.velocity.y = Math.min(8, Math.max(-8, currentMotion.velocity.y * 0.45 + (nextPosition.y - currentMotion.position.y) * 4.2));
    currentMotion.velocity.z = Math.min(12, Math.max(-12, currentMotion.velocity.z * 0.45 + (nextPosition.z - currentMotion.position.z) * 4.2));
    copyPosition(currentMotion.position, nextPosition);
    copyPosition(currentMotion.targetPosition, nextPosition);
    currentMotion.approachTarget = 0;
    currentMotion.mode = "coasting";
    currentMotion.travelStage = "overview";
    syncSpatialLocation();
  }, [state.inputLocked, syncSpatialLocation]);

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
    beginExplorationDrag,
    updateExplorationDrag,
    endExplorationDrag,
    nudgeExploration,
    setQuality,
    suppressBackdrop: (backdropDestination) => shellVisible && destination === backdropDestination
  }), [
    beginExplorationDrag,
    destination,
    enabled,
    endExplorationDrag,
    enterSelectedSystem,
    enterSystem,
    nudgeExploration,
    routeIsCompatible,
    selectAdjacentSystem,
    selectSystem,
    setEnabled,
    setQuality,
    shellVisible,
    state,
    travel,
    updateExplorationDrag
  ]);

  return (
    <IntelligenceUniverseContext.Provider value={value}>
      <IntelligenceUniverseShell />
      {children}
    </IntelligenceUniverseContext.Provider>
  );
}
