"use client";

import dynamic from "next/dynamic";

const IntelligenceSystemsSpatialCanvas = dynamic(
  () => import("@/components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas"),
  { ssr: false }
);

export function IntelligenceSystemsSpatialBackdrop() {
  return <IntelligenceSystemsSpatialCanvas />;
}
