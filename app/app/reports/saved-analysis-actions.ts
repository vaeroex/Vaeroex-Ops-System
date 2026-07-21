"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  type BusinessHealthExplanationArtifact
} from "@/lib/ai/business-health-explanation/contracts";
import { parseBusinessHealthExplanationArtifact } from "@/lib/ai/business-health-explanation/storage";
import {
  EXECUTIVE_BRIEF_CONTRACT_ID,
  type ExecutiveBriefArtifact
} from "@/lib/ai/executive-brief/contracts";
import { parseExecutiveBriefArtifact } from "@/lib/ai/executive-brief/storage";
import {
  FINDING_EXPLANATION_CONTRACT_ID,
  type FindingExplanationArtifact
} from "@/lib/ai/finding-explanation/contracts";
import { parseFindingExplanationArtifact } from "@/lib/ai/finding-explanation/storage";
import {
  SAVED_ANALYSIS_ENVELOPE_VERSION,
  type SavedAnalysisDisplaySection,
  type SavedAnalysisEnvelope,
  type SavedAnalysisReleaseChannel,
  type SavedAnalysisType,
  parseSavedAnalysisEnvelope
} from "@/lib/reports/saved-analysis";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import type { Json } from "@/lib/supabase/types";

type CompletedArtifact = ExecutiveBriefArtifact | BusinessHealthExplanationArtifact | FindingExplanationArtifact;
type SaveAnalysisInput = Readonly<{ analysisType: SavedAnalysisType; fingerprint: string; generatedAt: string }>;
type SavedAnalysisMutationResult = Readonly<{
  status: "saved" | "already_saved" | "deleted" | "error";
  id?: string;
  count?: number;
  message: string;
}>;

const contractByType: Record<SavedAnalysisType, string> = {
  executive_brief: EXECUTIVE_BRIEF_CONTRACT_ID,
  business_health: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  finding_explanation: FINDING_EXPLANATION_CONTRACT_ID
};

function releaseChannel(): SavedAnalysisReleaseChannel {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function parseArtifact(type: SavedAnalysisType, value: Json): CompletedArtifact | null {
  if (type === "executive_brief") return parseExecutiveBriefArtifact(value);
  if (type === "business_health") return parseBusinessHealthExplanationArtifact(value);
  return parseFindingExplanationArtifact(value);
}

function sectionsForExecutiveBrief(artifact: ExecutiveBriefArtifact): SavedAnalysisDisplaySection[] {
  const sections: SavedAnalysisDisplaySection[] = [];
  if (artifact.analysis.primary_concern) sections.push({ id: "primary-concern", label: "Primary concern", body: artifact.analysis.primary_concern });
  if (artifact.analysis.positive_signal) sections.push({ id: "positive-signal", label: "Positive signal", body: artifact.analysis.positive_signal });
  sections.push(
    { id: "why-it-matters", label: "Why it matters", body: artifact.analysis.why_it_matters },
    { id: "leadership-focus", label: "Leadership focus", body: artifact.analysis.leadership_focus }
  );
  if (artifact.analysis.provisional_hypothesis) {
    sections.push({ id: "supported-hypothesis", label: "Supported hypothesis", body: `Provisional: ${artifact.analysis.provisional_hypothesis}` });
  }
  sections.push({ id: "uncertainty", label: "What remains uncertain", body: artifact.analysis.uncertainty, tone: "limitation" });
  if (artifact.facts.limitations.length) {
    sections.push({ id: "limitations", label: "Known limitations", body: artifact.facts.limitations, tone: "limitation" });
  }
  return sections;
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

function analysisMetadata(type: SavedAnalysisType, artifact: CompletedArtifact) {
  if (type === "executive_brief") {
    const current = artifact as ExecutiveBriefArtifact;
    return {
      title: "Executive Brief",
      summaryLabel: "Executive summary",
      summary: current.analysis.executive_summary,
      confidence: current.facts.confidence,
      freshness: current.facts.freshness,
      evidenceStatus: `${current.citations.length} citation${current.citations.length === 1 ? "" : "s"} · ${current.facts.independentSourceCount} independent source${current.facts.independentSourceCount === 1 ? "" : "s"}`,
      dateRange: current.facts.latestEvidenceAt ? `Evidence through ${current.facts.latestEvidenceAt.slice(0, 10)}` : null,
      sections: sectionsForExecutiveBrief(current)
    } as const;
  }
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
      sections: sectionsForBusinessHealth(current)
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
  analysisType: SavedAnalysisType;
  sourceArtifactId: string;
  artifact: CompletedArtifact;
}) {
  return createHash("sha256")
    .update([workspaceId, channel, analysisType, sourceArtifactId, artifact.contractVersion, artifact.fingerprint].join("\n"))
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
    if (record(run.input_json).fingerprint !== fingerprint) continue;
    const artifact = parseArtifact(analysisType, run.output_json);
    if (artifact?.fingerprint === fingerprint && artifact.generatedAt === generatedAt) return { runId: run.id, artifact };
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
    channel: releaseChannel(),
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

  const channel = releaseChannel();
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
    evidence_fingerprint: completed.artifact.fingerprint,
    citations: completed.artifact.citations,
    evidence_lineage: completed.artifact.citations,
    display: {
      summary_label: metadata.summaryLabel,
      summary: metadata.summary,
      sections: metadata.sections,
      evidence_status: metadata.evidenceStatus,
      date_range: metadata.dateRange
    },
    artifact: completed.artifact as unknown as Json
  };
  const { data: report, error } = await supabase
    .from("reports")
    .insert({
      workspace_id: workspaceId,
      report_type: "Saved Analysis",
      title: envelope.title,
      date_range_start: null,
      date_range_end: null,
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
  const channel = releaseChannel();
  const { data, error } = await supabase
    .from("reports")
    .select("id,source_data_json")
    .eq("workspace_id", workspaceId)
    .in("id", uniqueIds)
    .is("deleted_at", null);
  const valid = (data || []).filter((row) => {
    const envelope = parseSavedAnalysisEnvelope(row.source_data_json);
    return envelope?.workspace_id === workspaceId && envelope.release_channel === channel;
  });
  if (error || valid.length !== uniqueIds.length) {
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

  const { data: deleted, error: deleteError } = await supabase
    .from("reports")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .in("id", uniqueIds)
    .is("deleted_at", null)
    .contains("source_data_json", { record_kind: "saved_analysis", release_channel: channel })
    .select("id");
  if (deleteError || deleted?.length !== uniqueIds.length) {
    return { status: "error", message: "The selected analyses could not all be deleted. Refresh before trying again." };
  }

  revalidatePath("/app/reports");
  return { status: "deleted", count: deleted.length, message: `${deleted.length} saved ${deleted.length === 1 ? "analysis" : "analyses"} deleted.` };
}

export async function currentSavedAnalysisReleaseChannel() {
  return releaseChannel();
}
