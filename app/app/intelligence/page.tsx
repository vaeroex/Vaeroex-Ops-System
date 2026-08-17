import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { buildFindingExplanationPackage } from "@/lib/ai/finding-explanation/context";
import { buildFindingExplanationFromSnapshotV1 } from "@/lib/ai/finding-explanation/snapshot-context";
import { trySealFindingExplanationPackage } from "@/lib/ai/finding-explanation/token";
import {
  isFindingExplanationEnabled,
  isIntelligenceBriefingEnabled
} from "@/lib/ai/providers/workflow-provider-policy";
import { loadWorkspaceIntelligenceBriefingStates } from "@/lib/ai/intelligence-briefing/workspace-context";
import { loadActiveWorkspaceKpis } from "@/lib/kpis/load-workspace-kpis";
import type { IntelligenceCardLifecycleRecord } from "@/lib/intelligence/card-lifecycle/contracts";
import { buildIntelligenceBlockedState } from "@/lib/intelligence/blocked-state";
import { buildIntelligenceCardIdentityV1, buildIntelligenceCardSnapshotV1 } from "@/lib/intelligence/card-lifecycle/identity";
import { buildIntelligenceCardLifecycleOverlayV1 } from "@/lib/intelligence/card-lifecycle/overlay";
import { trySealIntelligenceCardLifecycleToken } from "@/lib/intelligence/card-lifecycle/token";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { buildIntelligenceInboxFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/intelligence-inbox";
import { projectIntelligenceInboxV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { IntelligenceSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type IntelligencePageProps = {
  searchParams?: Promise<{ finding?: string }>;
};

export default async function IntelligencePage({ searchParams }: IntelligencePageProps) {
  const params = await searchParams;
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [issuesResult, kpisResult, kpiSettingsResult, filesResult, crmResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, metricsResult, memoryResult, lifecycleResult, briefingStates] = await Promise.all([
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    loadActiveWorkspaceKpis({ supabase, workspaceId }),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("indexed_at", { ascending: false }).limit(500),
    supabase.from("intelligence_card_lifecycle").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    loadWorkspaceIntelligenceBriefingStates({
      supabase,
      workspaceId,
      workspace: context.activeWorkspace || {}
    })
  ]);

  const lifecycleRecords = (lifecycleResult.data || []) as IntelligenceCardLifecycleRecord[];
  const dismissalActorIds = [...new Set(lifecycleRecords
    .filter((record) => record.lifecycle_state === "dismissed")
    .map((record) => record.last_mutated_by))];
  const dismissalActorsResult = dismissalActorIds.length
    ? await supabase.from("profiles").select("id,full_name,email").in("id", dismissalActorIds)
    : { data: [], error: null };
  const actorDisplayNames = Object.fromEntries((dismissalActorsResult.data || []).map((profile) => [
    profile.id,
    profile.full_name?.trim() || profile.email?.trim() || "Workspace leader"
  ]));

  const errors = [
    issuesResult.error,
    kpisResult.error,
    kpiSettingsResult.error,
    filesResult.error,
    crmResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    metricsResult.error,
    memoryResult.error,
    lifecycleResult.error,
    dismissalActorsResult.error
  ].filter(Boolean);

  if (errors.some((error) => isSecurityResponseMessage(error?.message))) {
    return (
      <div className="mx-auto max-w-3xl">
        <SecurityResponseNotice />
      </div>
    );
  }

  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [
      ...(kpisResult.data || []),
      ...(crmResult.data || []),
      ...(metricsResult.data || [])
    ]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const eligibleKpis = filterBySourceParentEligibility(kpisResult.data || [], sourceParentEligibility);
  const eligibleCustomerEvidence = filterBySourceParentEligibility(crmResult.data || [], sourceParentEligibility);
  const eligibleOperationalMetrics = filterBySourceParentEligibility(metricsResult.data || [], sourceParentEligibility);
  let eligibleMemoryChunks = [] as NonNullable<typeof memoryResult.data>;
  let memoryEligibilityError: Error | null = null;
  try {
    eligibleMemoryChunks = await filterEligibleMemoryRowsByLifecycle({
      supabase,
      workspaceId,
      rows: memoryResult.data || []
    });
  } catch (error) {
    memoryEligibilityError = error instanceof Error ? error : new Error("Business Memory eligibility could not be verified.");
  }
  const operationalInsights = buildOperationalEvidenceInsights({
    kpis: eligibleKpis,
    kpiSettings: kpiSettingsResult.data || [],
    operationalMetrics: eligibleOperationalMetrics,
    memoryChunks: eligibleMemoryChunks,
    files: filesResult.data || [],
    imports: importsResult.data || []
  });
  const displayErrors = [...errors, sourceParentResult.error, memoryEligibilityError].filter(Boolean) as Array<{ message: string }>;
  const snapshotAsOf = new Date().toISOString();
  const intelligence = buildIntelligenceLayer({
    asOf: snapshotAsOf,
    workspace: context.activeWorkspace,
    issues: issuesResult.data || [],
    kpis: eligibleKpis,
    kpiSettings: kpiSettingsResult.data || [],
    files: filesResult.data || [],
    crmLeads: eligibleCustomerEvidence,
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    operationalInsights
  });
  const blockedState = buildIntelligenceBlockedState({
    intelligence,
    kpis: eligibleKpis,
    settings: kpiSettingsResult.data || []
  });
  const businessNoteContextReleaseChannel = businessNoteReleaseChannel();
  const businessNoteContext = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId,
    releaseChannel: businessNoteContextReleaseChannel,
    asOf: snapshotAsOf
  });
  if (businessNoteContext.error) {
    console.error(JSON.stringify({
      level: "error",
      component: "finding-explanation",
      event: "business_note_context_load_failed",
      reason: businessNoteContext.error.message
    }));
  }
  let intelligenceSnapshot: IntelligenceSnapshotV1 | null = null;
  let displayedInsights = intelligence.insights;
  try {
    const snapshotBuild = buildIntelligenceSnapshotFromProducersV1({
      workspaceId,
      asOf: snapshotAsOf,
      intelligence,
      ...(businessNoteContext.records.length ? {
        contextualEvidence: {
          releaseChannel: businessNoteContextReleaseChannel,
          records: businessNoteContext.records
        }
      } : {})
    });
    intelligenceSnapshot = snapshotBuild.snapshot;
    const inbox = buildIntelligenceInboxFromSnapshotV1({
      projection: projectIntelligenceInboxV1(snapshotBuild.snapshot),
      intelligence
    });
    displayedInsights = inbox.insights;
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    console.error(JSON.stringify({
      level: "error",
      component: "intelligence-inbox",
      event: "snapshot_v1_projection_fallback",
      classification: "adapter_defect",
      reason: error instanceof Error ? error.message : "snapshot_construction_failed"
    }));
  }
  const userId = context.membership?.user_id;
  const explanationTokens = isFindingExplanationEnabled() && userId
    ? Object.fromEntries(displayedInsights.flatMap((insight) => {
        if (!["Risk", "Anomaly", "Bottleneck"].includes(insight.type)) return [];
        try {
          const analysisPackage = intelligenceSnapshot
            ? buildFindingExplanationFromSnapshotV1({
                workspaceId,
                insight,
                snapshot: intelligenceSnapshot,
                now: new Date(snapshotAsOf)
              }).analysisPackage
            : buildFindingExplanationPackage({ workspaceId, insight, now: new Date(snapshotAsOf) });
          if (!analysisPackage.requiredCitationIds.length) return [];
          const token = trySealFindingExplanationPackage({ analysisPackage, workspaceId, userId });
          return token ? [[insight.id, token]] : [];
        } catch {
          return [];
        }
      }))
    : {};
  const lifecycleIdentities = Object.fromEntries(displayedInsights.map((insight) => {
    const finding = intelligenceSnapshot?.findings.find((candidate) => candidate.id === insight.id) || null;
    return [insight.id, buildIntelligenceCardIdentityV1({ insight, finding })];
  }));
  const canManageLifecycle = Boolean(context.membership && ["owner", "admin", "manager"].includes(context.membership.role));
  const lifecycleTokens = canManageLifecycle && userId
    ? Object.fromEntries(displayedInsights.flatMap((insight) => {
        const identity = lifecycleIdentities[insight.id];
        const token = trySealIntelligenceCardLifecycleToken({
          workspaceId,
          userId,
          findingKeyHash: identity.findingKeyHash,
          findingFingerprint: insight.fingerprint,
          materialSignature: identity.materialSignature,
          findingId: insight.id,
          cardSnapshot: buildIntelligenceCardSnapshotV1(insight)
        });
        return token ? [[insight.id, token]] : [];
      }))
    : {};
  const lifecycleCards = buildIntelligenceCardLifecycleOverlayV1({
    insights: displayedInsights,
    identities: lifecycleIdentities,
    lifecycleRecords,
    lifecycleTokens,
    actorDisplayNames
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Executive Intelligence</p>
          <p className="mt-1 text-sm text-slate-400">Review current signals and rolling leadership briefings.</p>
        </div>
      </div>
      <ErrorNotice message={displayErrors[0]?.message || null} />
      <section aria-labelledby="intelligence-briefings-heading" className="space-y-4 border-b border-white/10 pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Leadership cadence</p>
            <h2 id="intelligence-briefings-heading" className="mt-1 text-xl font-semibold text-white">Intelligence Briefings</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">Generate rolling weekly and monthly syntheses from eligible business evidence, or return to the latest current briefing.</p>
          </div>
          <Link href="/app/intelligence/briefings" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:underline">
            <CalendarRange aria-hidden="true" className="h-4 w-4" /> Open Briefings
          </Link>
        </div>
        <IntelligenceBriefingCards
          states={briefingStates}
          generationEnabled={isIntelligenceBriefingEnabled()}
        />
      </section>
      <IntelligenceSignalInbox
        currentCards={lifecycleCards.current}
        historyCards={lifecycleCards.history}
        initialFindingId={params?.finding}
        explanationTokens={explanationTokens}
        canManageLifecycle={canManageLifecycle}
        blockedState={blockedState}
      />
    </div>
  );
}
