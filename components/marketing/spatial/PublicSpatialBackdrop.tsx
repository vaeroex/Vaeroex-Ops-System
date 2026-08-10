"use client";

import dynamic from "next/dynamic";

const PublicSpatialCanvas = dynamic(() => import("@/components/marketing/spatial/PublicSpatialCanvas"), {
  ssr: false
});

export function PublicSpatialBackdrop() {
  return <PublicSpatialCanvas />;
}
