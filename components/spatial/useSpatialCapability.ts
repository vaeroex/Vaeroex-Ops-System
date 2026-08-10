"use client";

import { useEffect, useState } from "react";

export type SpatialQualityTier = "full" | "constrained" | "reduced_motion";
export type SpatialCapabilityReason = "mobile" | "reduced_motion" | "low_power" | "webgl_unavailable";
export type SpatialCapability = Readonly<{
  ready: boolean;
  available: boolean;
  specializedAvailable: boolean;
  quality: SpatialQualityTier | null;
  reason: SpatialCapabilityReason | null;
}>;

const pendingCapability: SpatialCapability = {
  ready: false,
  available: false,
  specializedAvailable: false,
  quality: null,
  reason: null
};

function webglIsAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
      || canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true })
    );
  } catch {
    return false;
  }
}

function evaluateSpatialCapability({ allowMobile = false }: { allowMobile?: boolean } = {}): SpatialCapability {
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches;
  if (mobile && !allowMobile) {
    return { ready: true, available: false, specializedAvailable: false, quality: null, reason: "mobile" };
  }

  if (!webglIsAvailable()) {
    return { ready: true, available: false, specializedAvailable: false, quality: null, reason: "webgl_unavailable" };
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    return { ready: true, available: true, specializedAvailable: false, quality: "reduced_motion", reason: "reduced_motion" };
  }

  const device = navigator as Navigator & { deviceMemory?: number };
  const constrained = Boolean(
    mobile
    ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (device.deviceMemory && device.deviceMemory <= 4)
  );

  return constrained
    ? { ready: true, available: true, specializedAvailable: false, quality: "constrained", reason: "low_power" }
    : { ready: true, available: true, specializedAvailable: true, quality: "full", reason: null };
}

export function useSpatialCapability(options: { allowMobile?: boolean } = {}) {
  const [capability, setCapability] = useState<SpatialCapability>(pendingCapability);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const narrowViewport = window.matchMedia("(max-width: 767px)");
    const evaluate = () => setCapability(evaluateSpatialCapability(options));

    evaluate();
    reducedMotion.addEventListener("change", evaluate);
    coarsePointer.addEventListener("change", evaluate);
    narrowViewport.addEventListener("change", evaluate);
    return () => {
      reducedMotion.removeEventListener("change", evaluate);
      coarsePointer.removeEventListener("change", evaluate);
      narrowViewport.removeEventListener("change", evaluate);
    };
  }, [options.allowMobile]);

  return capability;
}
