"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { SpatialWorkspaceDestination } from "@/components/spatial/spatial-destinations";

export function SpatialRoutePlane({
  children,
  destination = "flat",
  enhanced = false,
  motion = "settled"
}: {
  children: ReactNode;
  destination?: SpatialWorkspaceDestination;
  enhanced?: boolean;
  motion?: "arriving" | "departing" | "settled";
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (enhanced && destination !== "flat") window.scrollTo(0, 0);
  }, [destination, enhanced, pathname]);

  return (
    <div
      key={pathname}
      className="vaeroex-route-plane"
      data-spatial-destination={destination}
      data-spatial-motion={enhanced && destination !== "flat" ? motion : "settled"}
      data-workspace-plane={pathname}
    >
      {enhanced && destination !== "flat" ? (
        <div className="vaeroex-route-frame" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      <div className="vaeroex-route-content">{children}</div>
    </div>
  );
}
