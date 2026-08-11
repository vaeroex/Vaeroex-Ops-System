"use client";

import dynamic from "next/dynamic";

const DrugDiscoverySpatialCanvas = dynamic(
  () => import("@/components/marketing/drug-discovery/DrugDiscoverySpatialCanvas"),
  { ssr: false }
);

export function DrugDiscoverySpatialBackdrop() {
  return <DrugDiscoverySpatialCanvas />;
}
