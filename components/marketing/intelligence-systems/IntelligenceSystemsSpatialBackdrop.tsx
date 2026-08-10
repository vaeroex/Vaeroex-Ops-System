"use client";

import dynamic from "next/dynamic";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";

const IntelligenceSystemsSpatialCanvas = dynamic(
  () => import("@/components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas"),
  { ssr: false }
);

export function IntelligenceSystemsSpatialBackdrop() {
  const universe = useIntelligenceUniverse();
  if (universe.suppressBackdrop("intelligence-systems")) {
    return <div data-universe-detail-deferred="intelligence-systems" aria-hidden="true" />;
  }
  return <IntelligenceSystemsSpatialCanvas />;
}
