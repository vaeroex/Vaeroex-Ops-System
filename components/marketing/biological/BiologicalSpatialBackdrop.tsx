"use client";

import dynamic from "next/dynamic";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";

const BiologicalSpatialCanvas = dynamic(
  () => import("@/components/marketing/biological/BiologicalSpatialCanvas"),
  { ssr: false }
);

export function BiologicalSpatialBackdrop() {
  const universe = useIntelligenceUniverse();
  if (universe.suppressBackdrop("biological-intelligence")) {
    return <div data-universe-detail-deferred="biological-intelligence" aria-hidden="true" />;
  }
  return <BiologicalSpatialCanvas />;
}
