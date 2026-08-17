import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";

export function intelligenceBriefingKpiEvidenceKey(identity: Readonly<{
  canonicalName: string;
  unit: string | null;
  scale: number;
  metricRole: string;
}>) {
  return evidenceEngineHash({
    canonicalName: identity.canonicalName,
    unit: identity.unit,
    scale: identity.scale,
    metricRole: identity.metricRole
  });
}
