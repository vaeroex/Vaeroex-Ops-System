"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  type BusinessHealthExplanationArtifact
} from "@/lib/ai/business-health-explanation/contracts";
import { parseBusinessHealthExplanationArtifact } from "@/lib/ai/business-health-explanation/storage";
import {
  FINDING_EXPLANATION_CONTRACT_ID,
  type FindingExplanationArtifact
} from "@/lib/ai/finding-explanation/contracts";
import { parseFindingExplanationArtifact } from "@/lib/ai/finding-explanation/storage";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  briefingTypeLabel,
  type IntelligenceBriefingArtifact
} from "@/lib/ai/intelligence-briefing/contracts";
import { parseIntelligenceBriefingArtifact } from "@/lib/ai/intelligence-briefing/storage";
import {
  SAVED_ANALYSIS_ENVELOPE_VERSION,
  type SavedAnalysisDisplaySection,
  type SavedAnalysisEnvelope,
  type SavedAnalysisReleaseChannel,
  type SaveableAnalysisType,
  parseSavedAnalysisEnvelope
} from "@/lib/reports/saved-analysis";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import type { Json } from "@/lib/supabase/types";

type CompletedArtifact = BusinessHealthExplanationArtifact | FindingExplanationArtifact | IntelligenceBriefingArtifact;
type SaveAnalysisInput = Readonly<{ analysisType: SaveableAnalysisType; fingerprint: string; generatedAt: string }>;
type SavedAnalysisMutationResult = Readonly<{
  status: "saved" | "already_saved" | "deleted" | "error";
  id?: string;
  count?: number;
  message: string;
}>;

const contractByType: Record<SaveableAnalysisType, string> = {
  business_health: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  finding_explanation: FINDING_EXPLANATION_CONTRACT_ID,
  weekly_briefing: INTELLIGENCE_BRIEFING_CONTRACT_ID,
  monthly_briefing: INTELLIGENCE_BRIEFING_CONTRACT_ID
};

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function parseArtifact(type: SaveableAnalysisType, value: Json): CompletedArtifact | null {
  if (type === "business_health") return parseBusinessHealthExplanationArtifact(value);
  if (type === "finding_explanation") return parseFindingExplanationArtifact(value);
  const artifact = parseIntelligenceBriefingArtifact(value);
  const briefingType = type === "weekly_briefing" ? "weekly" : "monthly";
  return artifact?.briefingType === briefingType ? artifact : null;
}

function artifactFingerprint(artifact: CompletedArtifact) {
  return "generationKey" in artifact ? artifact.generationKey : artifact.fingerprint;
}

function sectionsForBusinessHealth(artifact: BusinessHealthExplanationArtifact): SavedAnalysisDisplaySection[] {
  const sections: SavedAnalysisDisplaySection[] = [
    { id: "why-it-matters", label: "Why it matters", body: artifact.analysis.why_it_matters },
    { id: "leadership-consideration", label: "Leadership consideration", body: artifact.analysis.leadership_consideration }
  ];
  if (artifact.analysis.provisional_hypothesis) {
    sections.push({ id: "supported-hypothesis", label: "Supported hypothesis", body: `Provisional: ${artifact.analysis.provisional_hypothesis}` });
  }
  if (artifact.facts.limitations.length) {
    sections.push({ id: "limitations", label: "Known limitations", body: artifact.facts.limitations, tone: "limitation" });
  }
  sections.push(
    {
      id: "evidence-shows",
      label: "What the evidence shows",
      body: [
        `Business Health is ${artifact.facts.score === null ? "not yet established" : `${artifact.facts.score} out of 100`}.`,
        artifact.facts.deterministicSummary
      ],
      tone: "supporting"
    },
    {
      id: "state-trajectory",
      label: "State and trajectory",
      body: `${artifact.facts.status}${artifact.facts.trajectory ? ` · ${artifact.facts.trajectory}` : ""}`,
      tone: "supporting"
    },
    { id: "previous-review", label: "Previous review", body: artifact.facts.comparison, tone: "supporting" }
  );
  if (artifact.facts.drivers.length) {
    sections.push({
      id: "weighted-drivers",
      label: "Highest-weighted drivers",
      body: artifact.facts.drivers.map((driver) => `${driver.label} · ${driver.scoreImpact > 0 ? "+" : ""}${driver.scoreImpact} points${driver.citationIds.map((id) => ` [${id}]`).join("")}\n${driver.fact}`),
      tone: "supporting"
    });
  }
  return sections;
}

function sectionsForFinding(artifact: FindingExplanationArtifact): SavedAnalysisDisplaySection[] {
  return [
    { id: "evidence-suggests", label: "Why the evidence suggests it", body: artifact.analysis.why_evidence_suggests },
    { id: "leadership-care", label: "Why leadership should care", body: artifact.analysis.why_leadership_should_care },
    { id: "investigate-next", label: "What to investigate next", body: artifact.analysis.investigate_next },
    { id: "does-not-prove", label: "What the evidence does not prove", body: artifact.analysis.what_evidence_does_not_prove, tone: "limitation" }
  ];
}

function sectionsForBriefing(artifact: IntelligenceBriefingArtifact): SavedAnalysisDisplaySection[] {
  const sectionLabelById = new Map(artifact.sections.map((section) => [section.id, section.label]));
  return [
    ...artifact.analysis.sections.map((section) => ({
      id: section.section_id,
      label: sectionLabelById.get(section.section_id) || section.section_id,
      body: [section.summary, ...section.claims.map((claim) => claim.text)]
    } satisfies SavedAnalysisDisplaySection)),
    {
      id: "leadership-considerations",
      label: "Leadership considerations",
      body: artifact.analysis.leadership_considerations.map((claim) => claim.text),
      tone: "supporting"
    },
    ...(artifact.limitations.length ? [{
      id: "limitations",
      label: "Evidence limitations",
      body: artifact.limitations.map((limitation) => limitation.text),
      tone: "limitation" as const
    }] : [])
  ];
}

function analysisMetadata(type: SaveableAnalysisType, artifact: CompletedArtifact) {
  if (type === "business_health") {
    const current = artifact as BusinessHealthExplanationArtifact;
    return {
      title: "Business Health Analysis",
      summaryLabel: "Executive interpretation",
      summary: current.analysis.executive_interpretation,
      confidence: current.facts.confidence,
      freshness: current.facts.freshness,
      evidenceStatus: `${current.citations.length} supporting citation${current.citations.length === 1 ? "" : "s"}`,
      dateRange: current.facts.latestEvidenceAt ? `Evidence through ${current.facts.latestEvidenceAt.slice(0, 10)}` : null,
      businessHealthState: current.facts.status,
      sections: sectionsForBusinessHealth(current)
    } as const;
  }
  if (type === "weekly_briefing" || type === "monthly_briefing") {
    const current = artifact as IntelligenceBriefingArtifact;
    return {
      title: briefingTypeLabel(current.briefingType),
      summaryLabel: "Executive summary",
      summary: current.analysis.executive_summary.text,
      confidence: current.confidence,
      freshness: current.evidenceCoverage.freshness,
      evidenceStatus: `${current.citations.length} citation${current.citations.length === 1 ? "" : "s"} · ${current.evidenceCoverage.independentSourceCount} independent source${current.evidenceCoverage.independentSourceCount === 1 ? "" : "s"}`,
      dateRange: `${current.period.start} through ${current.period.end}`,
      businessHealthState: current.businessHealth.available ? current.businessHealth.status : null,
      sections: sectionsForBriefing(current)
    } as const;
  }
  const current = artifact as FindingExplanationArtifact;
  return {
    title: current.facts.title,
    summaryLabel: "What happened",
    summary: current.analysis.what_happened,
    confidence: current.facts.confidence,
    freshness: current.facts.freshness,
    evidenceStatus: `${current.citations.length} citation${current.citations.length === 1 ? "" : "s"} · ${current.facts.independentSourceCount} independent source${current.facts.independentSourceCount === 1 ? "" : "s"}`,
    dateRange: current.facts.timePeriod || null,
    businessHealthState: null,
    sections: sectionsForFinding(current)
  } as const;
}

function savedAnalysisKey({
  workspaceId,
  channel,
  analysisType,
  sourceArtifactId,
  artifact
}: {
  workspaceId: string;
  channel: SavedAnalysisReleaseChannel;
  analysisType: SaveableAnalysisType;
  sourceArtifactId: string;
  artifact: CompletedArtifact;
}) {
  return createHash("sha256")
    .update([workspaceId, channel, analysisType, sourceArtifactId, artifact.contractVersion, artifactFingerprint(artifact)].join("\n"))
    .digest("hex");
}

function markdownForEnvelope(envelope: SavedAnalysisEnvelope) {
  const sections = envelope.display.sections.map((section) => {
    const body = typeof section.body === "string" ? section.body : section.body.map((item) => `- ${item}`).join("\n");
    return `## ${section.label}\n${body}`;
  });
  return [`# ${envelope.title}`, envelope.display.summary, ...sections].join("\n\n");
}

async function completedArtifact({
  analysisType,
  fingerprint,
  generatedAt,
  workspaceId,
  supabase
}: SaveAnalysisInput & {
  workspaceId: string;
  supabase: Awaited<ReturnType<typeof requireWorkspaceAccess>>["supabase"];
}) {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .select("id,input_json,output_json,created_at")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", contractByType[analysisType])
    .eq("status", "completed")
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return null;
  for (const run of data || []) {
    const inputFingerprint = analysisType === "weekly_briefing" || analysisType === "monthly_briefing"
      ? record(run.input_json).generation_key
      : record(run.input_json).fingerprint;
    if (inputFingerprint !== fingerprint) continue;
    const artifact = parseArtifact(analysisType, run.output_json);
    if (artifact && artifactFingerprint(artifact) === fingerprint && artifact.generatedAt === generatedAt) return { runId: run.id, artifact };
  }
  return null;
}

async function existingSavedAnalysis({
  supabase,
  workspaceId,
  key
}: {
  supabase: Awaited<ReturnType<typeof requireWorkspaceAccess>>["supabase"];
  workspaceId: string;
  key: string;
}) {
  const { data } = await supabase
    .from("reports")
    .select("id,source_data_json")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .contains("source_data_json", { record_kind: "saved_analysis", saved_analysis_key: key })
    .maybeSingle();
  return data && parseSavedAnalysisEnvelope(data.source_data_json) ? data : null;
}

export async function getSavedAnalysisState(input: SaveAnalysisInput) {
  if (!contractByType[input.analysisType] || !/^[a-f0-9]{64}$/i.test(input.fingerprint) || Number.isNaN(Date.parse(input.generatedAt))) return { saved: false, id: null };
  const { supabase, workspaceId } = await requireWorkspaceAccess();
  const completed = await completedArtifact({ ...input, supabase, workspaceId });
  if (!completed) return { saved: false, id: null };
  const key = savedAnalysisKey({
    workspaceId,
    channel: currentSavedAnalysisReleaseChannel(),
    analysisType: input.analysisType,
    sourceArtifactId: completed.runId,
    artifact: completed.artifact
  });
  const existing = await existingSavedAnalysis({ supabase, workspaceId, key });
  return { saved: Boolean(existing), id: existing?.id || null };
}

export async function saveAnalysisAction(input: SaveAnalysisInput): Promise<SavedAnalysisMutationResult> {
  if (!contractByType[input.analysisType] || !/^[a-f0-9]{64}$/i.test(input.fingerprint) || Number.isNaN(Date.parse(input.generatedAt))) {
    return { status: "error", message: "This completed analysis could not be identified safely." };
  }
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const completed = await completedArtifact({ ...input, supabase, workspaceId });
  if (!completed) return { status: "error", message: "Only a completed validated analysis can be saved." };

  const channel = currentSavedAnalysisReleaseChannel();
  const key = savedAnalysisKey({ workspaceId, channel, analysisType: input.analysisType, sourceArtifactId: completed.runId, artifact: completed.artifact });
  const existing = await existingSavedAnalysis({ supabase, workspaceId, key });
  if (existing) return { status: "already_saved", id: existing.id, message: "Already saved" };

  try {
    await requireToolExecution(
      { supabase, workspaceId, userId: user.id, userRole: membership.role },
      {
        toolName: "save_completed_analysis",
        args: { sourceArtifactId: completed.runId, analysisType: input.analysisType, fingerprint: input.fingerprint },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: completed.runId,
        metadata: { source: "saved_analysis", analysis_type: input.analysisType }
      }
    );
  } catch {
    return { status: "error", message: "You do not have permission to save this analysis." };
  }

  const metadata = analysisMetadata(input.analysisType, completed.artifact);
  const savedAt = new Date().toISOString();
  const envelope: SavedAnalysisEnvelope = {
    record_kind: "saved_analysis",
    envelope_version: SAVED_ANALYSIS_ENVELOPE_VERSION,
    saved_analysis_key: key,
    workspace_id: workspaceId,
    release_channel: channel,
    analysis_type: input.analysisType,
    title: metadata.title,
    source_artifact: {
      id: completed.runId,
      workflow: contractByType[input.analysisType],
      contract_id: completed.artifact.contractId,
      contract_version: completed.artifact.contractVersion,
      validator_version: completed.artifact.validatorVersion,
      policy_id: completed.artifact.providerAttribution.providerPolicyId
    },
    provider_attribution: {
      provider: completed.artifact.providerAttribution.provider,
      model: completed.artifact.providerAttribution.model,
      fallback_used: completed.artifact.providerAttribution.fallbackUsed
    },
    generated_at: completed.artifact.generatedAt,
    saved_at: savedAt,
    confidence: metadata.confidence,
    freshness: metadata.freshness,
    evidence_fingerprint: artifactFingerprint(completed.artifact),
    citations: completed.artifact.citations,
    evidence_lineage: completed.artifact.citations,
    display: {
      summary_label: metadata.summaryLabel,
      summary: metadata.summary,
      sections: metadata.sections,
      evidence_status: metadata.evidenceStatus,
      date_range: metadata.dateRange,
      business_health_state: metadata.businessHealthState
    },
    artifact: completed.artifact as unknown as Json
  };
  const { data: report, error } = await supabase
    .from("reports")
    .insert({
      workspace_id: workspaceId,
      report_type: "Saved Analysis",
      title: envelope.title,
      date_range_start: "period" in completed.artifact ? completed.artifact.period.start : null,
      date_range_end: "period" in completed.artifact ? completed.artifact.period.end : null,
      body_markdown: markdownForEnvelope(envelope),
      source_data_json: envelope as unknown as Json,
      created_by: user.id
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") {
    const duplicate = await existingSavedAnalysis({ supabase, workspaceId, key });
    if (duplicate) return { status: "already_saved", id: duplicate.id, message: "Already saved" };
  }
  if (error || !report) return { status: "error", message: "The analysis could not be saved. Please try again." };

  revalidatePath("/app/reports");
  return { status: "saved", id: report.id, message: "Analysis saved" };
}

export async function deleteSavedAnalysesAction(ids: readonly string[]): Promise<SavedAnalysisMutationResult> {
  const uniqueIds = [...new Set(ids)].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)).slice(0, 300);
  if (!uniqueIds.length || uniqueIds.length !== new Set(ids).size) {
    return { status: "error", message: "The selected analyses could not be validated. Nothing was deleted." };
  }
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const channel = currentSavedAnalysisReleaseChannel();
  const { data: selectedRows, error: selectedRowsError } = await supabase
    .from("reports")
    .select("id,source_data_json")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .in("id", uniqueIds);
  const selectedById = new Map((selectedRows || []).map((row) => [row.id, parseSavedAnalysisEnvelope(row.source_data_json)]));
  const everySelectionIsCurrent = !selectedRowsError && uniqueIds.every((id) => {
    const envelope = selectedById.get(id);
    return envelope?.workspace_id === workspaceId && envelope.release_channel === channel;
  });

  if (!everySelectionIsCurrent) {
    return { status: "error", message: "One or more selected analyses are unavailable. Nothing was deleted." };
  }

  try {
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const batch = uniqueIds.slice(index, index + 100);
      await requireToolExecution(
        { supabase, workspaceId, userId: user.id, userRole: membership.role },
        {
          toolName: "bulk_manage_records",
          args: {
            recordIds: batch,
            collection: "reports",
            action: "delete",
            typedConfirmation: batch.length > 1 ? "DELETE" : undefined
          },
          initiatedBy: "user",
          confirmationReceived: true,
          metadata: { source: "saved_analysis", requested_count: uniqueIds.length, batch_index: index / 100 }
        }
      );
    }
  } catch {
    return { status: "error", message: "You do not have permission to delete these analyses. Nothing was deleted." };
  }

  const transactionalClient = supabase as unknown as {
    rpc: (
      name: "soft_delete_saved_analyses",
      args: {
        p_workspace_id: string;
        p_report_ids: string[];
        p_release_channel: SavedAnalysisReleaseChannel;
      }
    ) => Promise<{ data: number | null; error: { message: string } | null }>;
  };
  const { data: deletedCount, error: deleteError } = await transactionalClient.rpc(
    "soft_delete_saved_analyses",
    {
      p_workspace_id: workspaceId,
      p_report_ids: uniqueIds,
      p_release_channel: channel
    }
  );
  if (deleteError || deletedCount !== uniqueIds.length) {
    return { status: "error", message: "One or more selected analyses are unavailable. Nothing was deleted." };
  }

  revalidatePath("/app/reports");
  return { status: "deleted", count: deletedCount, message: `${deletedCount} saved ${deletedCount === 1 ? "analysis" : "analyses"} deleted.` };
}
