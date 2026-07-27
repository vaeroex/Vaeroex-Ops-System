"use client";

import { useState } from "react";
import {
  KPI_TARGET_BEHAVIOR_BY_DIRECTION,
  type KpiDesiredDirection,
  type KpiTargetBehavior
} from "@/lib/kpis/semantics";

const inputClass = "mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent";

const behaviorLabels: Record<KpiTargetBehavior, string> = {
  minimum_goal: "Minimum goal",
  maximum_limit: "Maximum acceptable limit",
  acceptable_range: "Acceptable range",
  exact_threshold: "Exact desired value",
  stability_goal: "Baseline or stability goal",
  unknown: "No directional target recommendation"
};

export function KpiPerformanceMeaningFields({
  initialDirection,
  initialIdealValue,
  initialRangeMin,
  initialRangeMax,
  definition,
  canonicalName,
  displayName,
  semanticUnit,
  aggregationBasis,
  periodBasis,
  metricRole
}: {
  initialDirection: KpiDesiredDirection;
  initialIdealValue: number | null;
  initialRangeMin: number | null;
  initialRangeMax: number | null;
  definition: string;
  canonicalName: string;
  displayName: string;
  semanticUnit: string;
  aggregationBasis: string;
  periodBasis: string;
  metricRole: "actual" | "target" | "benchmark" | "unknown";
}) {
  const [direction, setDirection] = useState(initialDirection);
  const targetBehavior = KPI_TARGET_BEHAVIOR_BY_DIRECTION[direction];

  return (
    <fieldset id="kpi-performance-meaning" className="grid gap-3 border-t border-white/10 pt-4 sm:col-span-2 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-white">Performance meaning</legend>
      <input type="hidden" name="semantic_update" value="true" />
      <input type="hidden" name="target_behavior" value={targetBehavior} />
      <input type="hidden" name="canonical_name" value={canonicalName} />
      <input type="hidden" name="display_name" value={displayName} />
      <input type="hidden" name="semantic_unit" value={semanticUnit} />
      <input type="hidden" name="aggregation_basis" value={aggregationBasis} />
      <input type="hidden" name="period_basis" value={periodBasis} />
      <input type="hidden" name="metric_role" value={metricRole} />

      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Performance direction
        <select
          name="desired_direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as KpiDesiredDirection)}
          className={inputClass}
        >
          <option value="maximize">Higher is better</option>
          <option value="minimize">Lower is better</option>
          <option value="target_range">Target range</option>
          <option value="exact_target">Exact target</option>
          <option value="maintain">Maintain stability</option>
          <option value="unknown">Not determined</option>
        </select>
      </label>

      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Target behavior
        <input value={behaviorLabels[targetBehavior]} readOnly className={inputClass} />
      </label>

      {direction === "target_range" ? (
        <>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Acceptable minimum
            <input name="ideal_range_min" type="number" step="any" defaultValue={initialRangeMin ?? ""} className={inputClass} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Acceptable maximum
            <input name="ideal_range_max" type="number" step="any" defaultValue={initialRangeMax ?? ""} className={inputClass} />
          </label>
          <input type="hidden" name="ideal_value" value="" />
        </>
      ) : direction === "exact_target" ? (
        <>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
            Exact desired value
            <input name="ideal_value" type="number" step="any" defaultValue={initialIdealValue ?? ""} className={inputClass} />
          </label>
          <input type="hidden" name="ideal_range_min" value="" />
          <input type="hidden" name="ideal_range_max" value="" />
        </>
      ) : direction === "unknown" ? (
        <>
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400 sm:col-span-2">
            Directional performance effects and target recommendations remain unavailable until this KPI meaning is confirmed.
          </p>
          <input type="hidden" name="ideal_value" value="" />
          <input type="hidden" name="ideal_range_min" value="" />
          <input type="hidden" name="ideal_range_max" value="" />
        </>
      ) : (
        <>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
            Theoretical ideal (optional)
            <input name="ideal_value" type="number" step="any" defaultValue={initialIdealValue ?? ""} className={inputClass} />
            <span className="mt-1 block normal-case tracking-normal text-slate-500">This is separate from the operational target above.</span>
          </label>
          <input type="hidden" name="ideal_range_min" value="" />
          <input type="hidden" name="ideal_range_max" value="" />
        </>
      )}

      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
        KPI definition
        <textarea
          name="definition"
          rows={3}
          defaultValue={definition}
          placeholder="Define what this KPI measures and how leadership should interpret it."
          className={inputClass}
        />
      </label>
    </fieldset>
  );
}
