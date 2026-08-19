"use client";

import { useEffect, useState } from "react";
import {
  classifySpatialCapability,
  type SpatialCapability
} from "@/components/spatial/spatialCapability";

export {
  classifySpatialCapability,
  classifySpatialViewport,
  type SpatialCapability,
  type SpatialCapabilityReason,
  type SpatialCapabilitySnapshot,
  type SpatialQualityTier,
  type SpatialViewportProfile
} from "@/components/spatial/spatialCapability";

const pendingCapability: SpatialCapability = {
  ready: false,
  available: false,
  specializedAvailable: false,
  quality: null,
  profile: "wide",
  reason: null
};

function probeWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
      || canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!context) return { available: false, maxTextureSize: 0 };

    const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) as number;
    const loseContext = context.getExtension("WEBGL_lose_context");
    loseContext?.loseContext();
    return { available: true, maxTextureSize };
  } catch {
    return { available: false, maxTextureSize: 0 };
  }
}

function evaluateSpatialCapability(): SpatialCapability {
  const webgl = probeWebGL();
  const device = navigator as Navigator & { deviceMemory?: number };
  return classifySpatialCapability({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: device.deviceMemory,
    maxTextureSize: webgl.maxTextureSize,
    webglAvailable: webgl.available
  });
}

export function useSpatialCapability() {
  const [capability, setCapability] = useState<SpatialCapability>(pendingCapability);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    let resizeFrame = 0;
    const evaluate = () => setCapability(evaluateSpatialCapability());
    const evaluateAfterResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(evaluate);
    };

    evaluate();
    reducedMotion.addEventListener("change", evaluate);
    coarsePointer.addEventListener("change", evaluate);
    window.addEventListener("resize", evaluateAfterResize, { passive: true });
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      reducedMotion.removeEventListener("change", evaluate);
      coarsePointer.removeEventListener("change", evaluate);
      window.removeEventListener("resize", evaluateAfterResize);
    };
  }, []);

  return capability;
}
