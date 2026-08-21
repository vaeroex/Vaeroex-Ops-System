import type { Database, Json } from "@/lib/supabase/types";
import { IsoDateSchema } from "@/lib/integrations/contracts/primitives";
import {
  DeterministicNodeStateSchema,
  type DeterministicNodeState
} from "@/lib/integrations/deterministic/contracts";
import { deterministicStateFingerprint } from "@/lib/integrations/deterministic/engine";
import { buildCanonicalKpiProducerOutputV1 } from "@/lib/kpis/snapshot-producer";
import type { KpiSettingRow } from "@/lib/kpis/settings";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

function stableUuidFromFingerprint(fingerprint: string) {
  const hex = fingerprint.slice("sha256:".length, "sha256:".length + 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function legacyNumber(value: string) {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    throw new Error("deterministic_shadow_legacy_number_out_of_range");
  }
  return converted;
}

export function deterministicKpiStatesToLegacyShadowRows({
  workspaceId,
  nodeKey,
  metricName,
  states: rawStates,
  asOfDate,
  generatedAt
}: {
  workspaceId: string;
  nodeKey: string;
  metricName: string;
  states: readonly DeterministicNodeState[];
  asOfDate: string;
  generatedAt: string;
}) {
  IsoDateSchema.parse(asOfDate);
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("deterministic_shadow_generated_at_invalid");
  }
  const states = DeterministicNodeStateSchema.array().parse(rawStates)
    .filter((state) => state.nodeKind === "kpi" && state.nodeKey === nodeKey)
    .sort((left, right) =>
      (left.scope.periodStart || "").localeCompare(right.scope.periodStart || "") ||
      left.nodeIdentityFingerprint.localeCompare(right.nodeIdentityFingerprint)
    );
  if (states.some((state) => state.workspaceId !== workspaceId)) {
    throw new Error("deterministic_shadow_workspace_substitution_denied");
  }

  const rows: KpiRow[] = states.map((state) => ({
    id: stableUuidFromFingerprint(state.nodeIdentityFingerprint),
    workspace_id: workspaceId,
    folder_id: null,
    name: metricName,
    category: null,
    target: null,
    actual_value: legacyNumber(state.valueCanonical),
    metric_date: state.scope.periodEnd || state.scope.periodStart || asOfDate,
    owner: null,
    notes: null,
    source: "deterministic_phase_3_shadow",
    source_file_id: null,
    import_id: null,
    import_row_id: null,
    raw_data_json: {
      contractVersion: state.contractVersion,
      exactValueCanonical: state.valueCanonical,
      nodeIdentityFingerprint: state.nodeIdentityFingerprint,
      sourceContributionAccumulator: state.sourceContributionAccumulator,
      registryVersion: state.registryVersion,
      registryFingerprint: state.registryFingerprint,
      calculationPolicyVersion: state.calculationPolicyVersion,
      calculationVersion: state.calculationVersion,
      shadowOnly: true,
      promotionAuthorized: false
    } satisfies Json,
    created_by: null,
    created_at: generatedAt,
    updated_at: generatedAt,
    archived_at: null,
    deleted_at: null
  }));

  return {
    rows,
    exactValues: states.map((state) => ({
      nodeIdentityFingerprint: state.nodeIdentityFingerprint,
      valueCanonical: state.valueCanonical
    })),
    shadowOnly: true as const,
    promotionAuthorized: false as const
  };
}

export function buildLegacyKpiShadowProducerV1({
  workspaceId,
  nodeKey,
  metricName,
  states,
  settings,
  asOf
}: {
  workspaceId: string;
  nodeKey: string;
  metricName: string;
  states: readonly DeterministicNodeState[];
  settings: KpiSettingRow[];
  asOf: string;
}) {
  const asOfDate = IsoDateSchema.parse(asOf.slice(0, 10));
  const shadow = deterministicKpiStatesToLegacyShadowRows({
    workspaceId,
    nodeKey,
    metricName,
    states,
    asOfDate,
    generatedAt: asOf
  });
  return {
    ...shadow,
    exactStateFingerprint: deterministicStateFingerprint(states),
    producer: buildCanonicalKpiProducerOutputV1({
      workspaceId,
      rows: shadow.rows,
      settings,
      asOf
    })
  };
}
