"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { SpatialErrorBoundary } from "@/components/spatial/SpatialErrorBoundary";
import { useSpatialCapability } from "@/components/spatial/useSpatialCapability";
import { useIntelligenceUniverse } from "@/components/marketing/intelligence-universe/IntelligenceUniverseContext";
import styles from "@/components/marketing/intelligence-universe/intelligence-universe.module.css";

const IntelligenceUniverseCanvas = dynamic(
  () => import("@/components/marketing/intelligence-universe/IntelligenceUniverseCanvas"),
  { ssr: false }
);

function UniverseFallback({ reason }: { reason: string }) {
  return (
    <div className={styles.fallback} data-intelligence-universe-fallback={reason} aria-hidden="true">
      <div className={styles.fallbackFrames}>{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>
      <div className={styles.fallbackSystems}>{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
    </div>
  );
}

export function IntelligenceUniverseBackdrop() {
  const universe = useIntelligenceUniverse();
  const capability = useSpatialCapability({ allowMobile: true });

  useEffect(() => {
    if (!capability.ready) {
      universe.setQuality("pending");
      return;
    }
    universe.setQuality(capability.available && capability.quality ? capability.quality : "fallback");
  }, [capability.available, capability.quality, capability.ready, universe.setQuality]);

  if (!capability.ready) return null;
  if (!capability.available || !capability.quality) {
    return <UniverseFallback reason={capability.reason || "unavailable"} />;
  }

  return (
    <SpatialErrorBoundary fallback={<UniverseFallback reason="render_error" />}>
      <IntelligenceUniverseCanvas
        active={universe.shellVisible}
        state={universe.state}
        motion={universe.motion}
        quality={capability.quality}
      />
    </SpatialErrorBoundary>
  );
}
