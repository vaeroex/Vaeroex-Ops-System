import { excludeChecklistDerivedRecords } from "@/lib/intelligence/checklist-retirement";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import type { Database } from "@/lib/supabase/types";

type AiAgentRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];

export type OverviewRunCompatibility = Readonly<{
  derivedFindingCount: number;
  latestEvidenceUpdate: string | null;
  snapshotSourceCount: number;
}>;

export function eligibleOverviewCompatibilityRuns(runs: readonly AiAgentRunRow[]) {
  return excludeChecklistDerivedRecords(
    filterBusinessEvidence([...runs], { sourceKind: "platform_run" })
  );
}

/**
 * Retains the pre-retirement Overview count and freshness semantics without
 * allowing generated run payloads to become canonical intelligence inputs.
 */
export function buildOverviewRunCompatibility(runs: readonly AiAgentRunRow[]): OverviewRunCompatibility {
  const eligibleRuns = eligibleOverviewCompatibilityRuns(runs);
  const latestEvidenceUpdate = eligibleRuns
    .map((run) => run.updated_at || run.created_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null;

  return Object.freeze({
    derivedFindingCount: eligibleRuns.length,
    latestEvidenceUpdate,
    snapshotSourceCount: eligibleRuns.length
  });
}

export function latestOverviewEvidenceUpdate(
  evidenceDates: readonly (string | null | undefined)[],
  compatibility: OverviewRunCompatibility
) {
  return [...evidenceDates, compatibility.latestEvidenceUpdate]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null;
}
