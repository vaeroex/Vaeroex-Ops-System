"use client";

import dynamic from "next/dynamic";

const ExecutiveIntelligenceSpatialCanvas = dynamic(
  () => import("@/components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialCanvas"),
  { ssr: false }
);

export function ExecutiveIntelligenceSpatialBackdrop() {
  return <ExecutiveIntelligenceSpatialCanvas />;
}
