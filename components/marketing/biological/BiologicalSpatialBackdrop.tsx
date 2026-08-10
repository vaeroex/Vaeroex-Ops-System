"use client";

import dynamic from "next/dynamic";

const BiologicalSpatialCanvas = dynamic(
  () => import("@/components/marketing/biological/BiologicalSpatialCanvas"),
  { ssr: false }
);

export function BiologicalSpatialBackdrop() {
  return <BiologicalSpatialCanvas />;
}
