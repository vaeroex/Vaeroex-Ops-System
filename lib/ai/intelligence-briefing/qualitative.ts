import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type { IntelligenceBriefingPackage } from "./contracts";
import type { SynthesisSource } from "@/lib/ai/shared-evidence/qualitative-synthesis";

/** Bind prose to the application-issued signal and all its exact dependencies.
 * This hash is integrity metadata, never permission or proof of entailment. */
export function briefingSynthesisSources(context: Pick<IntelligenceBriefingPackage, "signals" | "contextReferences">): SynthesisSource[] {
  return context.signals.filter(signal => !signal.sharedRelationship && signal.citationIds.length > 0 && signal.evidenceReferenceIds.length > 0).map((signal):SynthesisSource => {
    const reported = signal.authority === "reported_context";
    const sourceContext = context.contextReferences.find(reference => reference.ref === signal.ref);
    return { ref: signal.ref, binding: evidenceEngineHash({contract:"qualitative_binding_v1",ref:signal.ref,key:signal.stableKey,fact:signal.fact,dependencies:signal.evidenceReferenceIds,citations:signal.citationIds,scope:signal.sourceScope??null,authority:signal.authority}),
      dependencies:[...new Set(signal.evidenceReferenceIds)].sort(),facts: [signal.fact], reported: reported ? sourceContext?.sourceKind === "reviewed_file" ? "file" : "note" : false,
      environment: reported ? "supporting" : signal.sourceScope?.environment === "sandbox" ? "sandbox" : "production",
      ...(typeof signal.sourceScope?.installationId === "string" ? {installation:signal.sourceScope.installationId} : {}) };
  });
}
