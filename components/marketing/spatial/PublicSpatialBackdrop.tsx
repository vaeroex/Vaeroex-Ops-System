"use client";

import dynamic from "next/dynamic";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";

const PublicSpatialCanvas = dynamic(() => import("@/components/marketing/spatial/PublicSpatialCanvas"), {
  ssr: false
});

export function PublicSpatialBackdrop() {
  const universe = useIntelligenceUniverse();
  if (universe.suppressBackdrop("vaeroex")) {
    return <div data-universe-detail-deferred="vaeroex" aria-hidden="true" />;
  }
  return <PublicSpatialCanvas />;
}
