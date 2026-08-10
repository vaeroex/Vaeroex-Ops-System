"use client";

import dynamic from "next/dynamic";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";

const DrugDiscoverySpatialCanvas = dynamic(
  () => import("@/components/marketing/drug-discovery/DrugDiscoverySpatialCanvas"),
  { ssr: false }
);

export function DrugDiscoverySpatialBackdrop() {
  const universe = useIntelligenceUniverse();
  if (universe.suppressBackdrop("drug-discovery-intelligence")) {
    return <div data-universe-detail-deferred="drug-discovery-intelligence" aria-hidden="true" />;
  }
  return <DrugDiscoverySpatialCanvas />;
}
