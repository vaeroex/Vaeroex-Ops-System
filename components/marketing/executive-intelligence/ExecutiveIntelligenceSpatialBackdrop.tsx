"use client";

import dynamic from "next/dynamic";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";

const ExecutiveIntelligenceSpatialCanvas = dynamic(
  () => import("@/components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialCanvas"),
  { ssr: false }
);

export function ExecutiveIntelligenceSpatialBackdrop() {
  const universe = useIntelligenceUniverse();
  if (universe.suppressBackdrop("executive-intelligence")) {
    return <div data-universe-detail-deferred="executive-intelligence" aria-hidden="true" />;
  }
  return <ExecutiveIntelligenceSpatialCanvas />;
}
