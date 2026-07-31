import type { IntelligenceConfidence, IntelligenceInsight, IntelligenceInsightType } from "@/lib/intelligence/layer";

export const INTELLIGENCE_CARD_LIFECYCLE_VERSION = "intelligence_card_lifecycle_v1" as const;
export const INTELLIGENCE_CARD_RECHECK_DAYS = 30;

export type IntelligenceCardLifecycleState = "active" | "acknowledged" | "dismissed";
export type IntelligenceCardLifecycleAction = "acknowledge" | "dismiss" | "pin" | "unpin";
export type IntelligenceCardLifecycleReason = "irrelevant" | "duplicate" | "temporary" | "not_material" | "other";
export type IntelligenceCardReopenReason = "material_change" | "recheck_due" | null;

export type IntelligenceCardSnapshotV1 = Readonly<{
  version: typeof INTELLIGENCE_CARD_LIFECYCLE_VERSION;
  findingId: string;
  type: IntelligenceInsightType;
  title: string;
  summary: string;
  priority: "High" | "Medium" | "Low";
  confidence: IntelligenceConfidence;
  affectedArea: string;
  lastUpdated: string;
}>;

export type IntelligenceCardLifecycleRecord = Readonly<{
  id: string;
  workspace_id: string;
  finding_key_hash: string;
  finding_fingerprint: string;
  lifecycle_state: IntelligenceCardLifecycleState;
  state_material_signature: string | null;
  last_material_signature: string;
  last_finding_id: string;
  reason_code: IntelligenceCardLifecycleReason | null;
  reason_text: string | null;
  recheck_after: string | null;
  pinned: boolean;
  pinned_by: string | null;
  pinned_at: string | null;
  card_snapshot_json: IntelligenceCardSnapshotV1;
  last_mutated_by: string;
  last_mutated_at: string;
  created_at: string;
  updated_at: string;
}>;

export type IntelligenceCardIdentityV1 = Readonly<{
  findingKeyHash: string;
  materialSignature: string;
  deterministicDependencyIds: readonly string[];
}>;

export type IntelligenceLifecycleCardV1 = Readonly<{
  findingKeyHash: string;
  materialSignature: string;
  findingId: string;
  insight: IntelligenceInsight | null;
  snapshot: IntelligenceCardSnapshotV1;
  lifecycleState: IntelligenceCardLifecycleState;
  pinned: boolean;
  view: "current" | "history";
  currentFeedStatus: "surfaced" | "not_currently_surfaced";
  reopenReason: IntelligenceCardReopenReason;
  reopenedFrom: "acknowledged" | "dismissed" | null;
  reasonCode: IntelligenceCardLifecycleReason | null;
  reasonText: string | null;
  dismissedBy: string | null;
  recheckAfter: string | null;
  stateChangedAt: string | null;
  lifecycleToken: string | null;
}>;

export type IntelligenceCardLifecycleActionResult = Readonly<{
  ok: boolean;
  message: string;
}>;
