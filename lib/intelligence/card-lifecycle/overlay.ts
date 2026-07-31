import type { IntelligenceInsight } from "@/lib/intelligence/layer";
import {
  INTELLIGENCE_CARD_LIFECYCLE_VERSION,
  type IntelligenceCardIdentityV1,
  type IntelligenceCardLifecycleRecord,
  type IntelligenceCardSnapshotV1,
  type IntelligenceLifecycleCardV1
} from "@/lib/intelligence/card-lifecycle/contracts";
import { buildIntelligenceCardSnapshotV1 } from "@/lib/intelligence/card-lifecycle/identity";

const insightTypes = new Set(["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"]);
const priorities = new Set(["High", "Medium", "Low"]);
const confidences = new Set(["High", "Medium", "Low"]);

function isHistoricalSnapshot(value: unknown): value is IntelligenceCardSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<IntelligenceCardSnapshotV1>;
  return candidate.version === INTELLIGENCE_CARD_LIFECYCLE_VERSION
    && typeof candidate.findingId === "string"
    && typeof candidate.title === "string"
    && typeof candidate.summary === "string"
    && typeof candidate.affectedArea === "string"
    && typeof candidate.lastUpdated === "string"
    && insightTypes.has(String(candidate.type))
    && priorities.has(String(candidate.priority))
    && confidences.has(String(candidate.confidence));
}

export function effectiveLifecycleStateV1({
  record,
  materialSignature,
  nowMs = Date.now()
}: {
  record: IntelligenceCardLifecycleRecord | null;
  materialSignature: string;
  nowMs?: number;
}) {
  if (!record) return { state: "active" as const, reopenReason: null, reopenedFrom: null };
  if (
    (record.lifecycle_state === "acknowledged" || record.lifecycle_state === "dismissed")
    && record.state_material_signature !== materialSignature
  ) {
    return { state: "active" as const, reopenReason: "material_change" as const, reopenedFrom: record.lifecycle_state };
  }
  if (
    record.lifecycle_state === "dismissed"
    && record.recheck_after
    && new Date(record.recheck_after).getTime() <= nowMs
  ) {
    return { state: "active" as const, reopenReason: "recheck_due" as const, reopenedFrom: "dismissed" as const };
  }
  return { state: record.lifecycle_state, reopenReason: null, reopenedFrom: null };
}

export function buildIntelligenceCardLifecycleOverlayV1({
  insights,
  identities,
  lifecycleRecords,
  lifecycleTokens = {},
  actorDisplayNames = {},
  nowMs = Date.now()
}: {
  insights: readonly IntelligenceInsight[];
  identities: Readonly<Record<string, IntelligenceCardIdentityV1>>;
  lifecycleRecords: readonly IntelligenceCardLifecycleRecord[];
  lifecycleTokens?: Readonly<Record<string, string>>;
  actorDisplayNames?: Readonly<Record<string, string>>;
  nowMs?: number;
}) {
  const recordsByKey = new Map(lifecycleRecords.map((record) => [record.finding_key_hash, record]));
  const surfacedKeys = new Set<string>();
  const current: IntelligenceLifecycleCardV1[] = [];
  const history: IntelligenceLifecycleCardV1[] = [];

  for (const insight of insights) {
    const identity = identities[insight.id];
    if (!identity) throw new Error(`Finding ${insight.id} is missing its lifecycle identity.`);
    surfacedKeys.add(identity.findingKeyHash);
    const record = recordsByKey.get(identity.findingKeyHash) || null;
    const effective = effectiveLifecycleStateV1({ record, materialSignature: identity.materialSignature, nowMs });
    const card: IntelligenceLifecycleCardV1 = {
      findingKeyHash: identity.findingKeyHash,
      materialSignature: identity.materialSignature,
      findingId: insight.id,
      insight,
      snapshot: buildIntelligenceCardSnapshotV1(insight),
      lifecycleState: effective.state,
      pinned: record?.pinned || false,
      view: effective.state === "dismissed" ? "history" : "current",
      currentFeedStatus: "surfaced",
      reopenReason: effective.reopenReason,
      reopenedFrom: effective.reopenedFrom,
      reasonCode: record?.reason_code || null,
      reasonText: record?.reason_text || null,
      dismissedBy: record?.lifecycle_state === "dismissed"
        ? actorDisplayNames[record.last_mutated_by] || "Workspace leader"
        : null,
      recheckAfter: record?.recheck_after || null,
      stateChangedAt: record?.last_mutated_at || null,
      lifecycleToken: lifecycleTokens[insight.id] || null
    };
    (card.view === "history" ? history : current).push(card);
  }

  for (const record of lifecycleRecords) {
    if (surfacedKeys.has(record.finding_key_hash) || !isHistoricalSnapshot(record.card_snapshot_json)) continue;
    history.push({
      findingKeyHash: record.finding_key_hash,
      materialSignature: record.last_material_signature,
      findingId: record.last_finding_id,
      insight: null,
      snapshot: record.card_snapshot_json,
      lifecycleState: record.lifecycle_state,
      pinned: record.pinned,
      view: "history",
      currentFeedStatus: "not_currently_surfaced",
      reopenReason: null,
      reopenedFrom: null,
      reasonCode: record.reason_code,
      reasonText: record.reason_text,
      dismissedBy: record.lifecycle_state === "dismissed"
        ? actorDisplayNames[record.last_mutated_by] || "Workspace leader"
        : null,
      recheckAfter: record.recheck_after,
      stateChangedAt: record.last_mutated_at,
      lifecycleToken: null
    });
  }

  return { current, history } as const;
}
