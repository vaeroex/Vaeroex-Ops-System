"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import { beginGoogleSheetsRead, bindGoogleSheetsRead, googleSheetsReadTicketFields } from "@/lib/integrations/google-sheets/read-authority";
import { loadVsiExchange, exchangeView, vsiUuid } from "@/lib/vsi/storage";
import { vsiComparisons } from "@/lib/charts/vsi-snapshot";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import { parseSavedAnalysisEnvelope, type SavedAnalysisEnvelope } from "@/lib/reports/saved-analysis";
import type { Json } from "@/lib/supabase/types";

export async function saveVsiAnalysis(exchangeId: string): Promise<{ id?: string; message: string }> {
  if (!vsiUuid.safeParse(exchangeId).success) return { message: "This answer could not be identified safely." };
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const ticket = await beginGoogleSheetsRead(supabase, workspaceId, user.id).catch(() => null);
  if (!ticket) return { message: "Workspace evidence is being updated. Reload before saving." };
  const row = await loadVsiExchange({ supabase, workspaceId, userId: user.id, canEditBusinessNotes: false }, exchangeId);
  if (!row) return { message: "This answer is unavailable in your active workspace." };
  const exchange = exchangeView(row), comparisons = vsiComparisons(exchange.citations);
  if (!comparisons.length) return { message: "This answer has no supported comparison snapshot to save." };
  const fingerprint = createHash("sha256").update(JSON.stringify({ answer: row.answer, citations: row.citations })).digest("hex");
  const channel = currentSavedAnalysisReleaseChannel();
  const key = createHash("sha256").update(`${workspaceId}:${channel}:vsi:${user.id}:${row.id}:${fingerprint}`).digest("hex");
  try {
    await requireToolExecution({ supabase, workspaceId, userId: user.id, userRole: membership.role }, {
      toolName: "save_completed_analysis", args: { sourceArtifactId: row.id, analysisType: "vsi", fingerprint },
      initiatedBy: "user", confirmationReceived: true, targetRecordId: row.id, metadata: { source: "vsi_saved_analysis" }
    });
    await bindGoogleSheetsRead(supabase, ticket.ticketId, [{ table: "vsi_exchanges", id: row.id }]);
  } catch { return { message: "Your role or current evidence access does not allow saving this answer." }; }
  const existing = async () => {
    const { data } = await supabase.from("reports").select("id,source_data_json").eq("workspace_id", workspaceId).is("deleted_at", null).contains("source_data_json", { record_kind: "saved_analysis", saved_analysis_key: key }).maybeSingle();
    return data && parseSavedAnalysisEnvelope(data.source_data_json) ? data.id : undefined;
  };
  const prior = await existing();
  if (prior) return { id: prior, message: "Already saved." };
  const citations = exchange.citations.map((source, index) => ({ citationId: index + 1, title: `[${source.id}] ${source.title}`, sourceLabel: source.sourceType, sourceType: source.sourceType,
    excerpt: source.excerpt || source.title, recordedAt: source.evidenceDate,
    ...(/^\/app\//.test(source.url) && !/[\\\r\n]/.test(source.url) ? { href: source.url as `/app/${string}` } : {}) }));
  const envelope: SavedAnalysisEnvelope = {
    record_kind: "saved_analysis", envelope_version: 1, saved_analysis_key: key, workspace_id: workspaceId, release_channel: channel,
    analysis_type: "vsi", title: `VSI · ${row.user_message.slice(0, 140)}`,
    source_artifact: { id: row.id, workflow: "vsi", contract_id: "vsi_exchange_v1", contract_version: "vsi_exchange_v1", validator_version: "vsi_citation_validation_v1", policy_id: "vsi" },
    provider_attribution: { provider: "openai", model: "gpt-6-luna", fallback_used: false },
    generated_at: row.created_at, saved_at: new Date().toISOString(), confidence: "Low", freshness: "unavailable", evidence_fingerprint: fingerprint,
    citations, evidence_lineage: citations, comparisons,
    display: { summary_label: "Question", summary: row.user_message, sections: [{ id: "vsi-answer", label: "VSI response", body: row.answer }, { id: "limits", label: "Interpretation limits", body: "Saved response, not an independently validated conclusion. Chart values preserve the cited observations at answer time; newer evidence is not substituted.", tone: "limitation" }], evidence_status: "Saved evidence snapshot · current freshness not re-evaluated", date_range: null },
    artifact: { exchangeId: row.id, citations: row.citations }
  };
  const { data, error } = await supabase.from("reports").insert({ ...googleSheetsReadTicketFields(ticket.ticketId), workspace_id: workspaceId, report_type: "Saved Analysis", title: envelope.title,
    body_markdown: `# ${envelope.title}\n\n${row.answer}`, source_data_json: envelope as unknown as Json, created_by: user.id }).select("id").maybeSingle();
  if (error?.code === "23505") { const id = await existing(); if (id) return { id, message: "Already saved." }; }
  if (error || !data) return { message: "The analysis could not be saved. Please try again." };
  revalidatePath("/app/reports");
  return { id: data.id, message: "Analysis saved to this workspace." };
}
