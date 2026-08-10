"use client";

import dynamic from "next/dynamic";
import { Box, ChartNoAxesCombined } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { KpiSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";
import { buildSpatialKpiSceneModelV1 } from "@/lib/presentation/spatial-kpi";
import { SpatialErrorBoundary } from "@/components/spatial/SpatialErrorBoundary";
import { useSpatialCapability } from "@/components/spatial/useSpatialCapability";

const KpiSpatialCanvas = dynamic(() => import("@/components/spatial/KpiSpatialCanvas"), {
  ssr: false,
  loading: () => <div className="vaeroex-webgl-loading vaeroex-webgl-loading--kpi">Preparing 3D KPI view...</div>
});

export function KpiVisualizationSwitcher({
  kpi,
  color,
  children
}: {
  kpi: KpiSnapshotV1 | null;
  color: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const capability = useSpatialCapability();
  const model = useMemo(() => kpi ? buildSpatialKpiSceneModelV1(kpi) : null, [kpi]);

  if (!model || model.points.length === 0) return children;

  const selectedPoint = model.points.find((point) => point.id === selectedPointId) || model.points.at(-1) || null;
  const effectiveSelectedPointId = selectedPoint?.id || null;

  return (
    <div className="space-y-3" data-spatial-kpi-boundary="intelligence_snapshot_v1">
      <div className="vaeroex-view-toolbar vaeroex-view-toolbar--compact">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Chart view</p>
          {selectedPointId && selectedPoint ? (
            <p className="mt-1 text-xs text-slate-400">Selected {new Date(selectedPoint.observedAt).toLocaleDateString()} · {selectedPoint.value}{model.unit ? ` ${model.unit}` : ""}</p>
          ) : null}
        </div>
        <div className="vaeroex-view-segment vaeroex-view-segment--dark" role="group" aria-label="KPI visualization">
          <button type="button" className={view === "2d" ? "is-active" : undefined} aria-pressed={view === "2d"} onClick={() => setView("2d")}>
            <ChartNoAxesCombined aria-hidden="true" className="h-4 w-4" /> 2D
          </button>
          <button type="button" className={view === "3d" ? "is-active" : undefined} aria-pressed={view === "3d"} onClick={() => setView("3d")}>
            <Box aria-hidden="true" className="h-4 w-4" /> 3D
          </button>
        </div>
      </div>
      {view === "2d" ? children : null}
      {view === "3d" && !capability.ready ? <div className="vaeroex-webgl-loading vaeroex-webgl-loading--kpi">Checking WebGL support...</div> : null}
      {view === "3d" && capability.ready && !capability.specializedAvailable ? (
        <div className="space-y-3">
          <div className="vaeroex-webgl-fallback">3D view is unavailable on this device. The 2D chart remains fully available.</div>
          {children}
        </div>
      ) : null}
      {view === "3d" && capability.specializedAvailable ? (
        <SpatialErrorBoundary fallback={<div className="space-y-3"><div className="vaeroex-webgl-fallback">3D rendering stopped safely. The 2D chart remains authoritative.</div>{children}</div>}>
          <KpiSpatialCanvas model={model} color={color} selectedId={effectiveSelectedPointId} onSelect={setSelectedPointId} />
        </SpatialErrorBoundary>
      ) : null}
    </div>
  );
}
