import "server-only";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import { loadWorkspaceHealthEvidence } from "@/lib/intelligence/workspace-health";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { SupabasePgvectorCandidateRetriever } from "@/lib/ai/evidence-index";
import { EVIDENCE_QUERY_VERSION } from "@/lib/ai/evidence-engine/contracts";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { assertDocumentExtractionAuthority } from "@/lib/document-extraction/approval-guard";
import { kpiSemantics } from "@/lib/kpis/settings";
import { loadIntegrationDashboard } from "@/lib/integrations/dashboard/server";
import { parseSavedAnalysisEnvelope } from "@/lib/reports/saved-analysis";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import type { WorkspaceAccess } from "@/lib/security/types";
import type { VsiRunInput, VsiEvidence, VsiEvidenceResult } from "./types";

export async function authorizeVsiRead(input: Pick<VsiRunInput, "supabase" | "workspaceId" | "actorUserId">): Promise<WorkspaceAccess> {
  const { data: { user }, error } = await input.supabase.auth.getUser();
  if (error || !user || user.id !== input.actorUserId) throw new Error("Sign in again to use Vaeroex Super Intelligence.");
  const context = await getWorkspaceContext(input.workspaceId, { supabase: input.supabase, user });
  if (!context.activeWorkspace || context.activeWorkspace.id !== input.workspaceId || !context.membership
    || context.membership.workspace_id !== input.workspaceId || context.membership.user_id !== user.id || context.membership.status !== "active") {
    throw new Error("You no longer have access to this workspace. Choose an available workspace.");
  }
  const entitled = await getSubscriptionStatus({ supabase: input.supabase, workspaceId: input.workspaceId, userId: user.id, email: user.email });
  if (!entitled.allowed) throw new Error("This workspace needs an active subscription to use Vaeroex Super Intelligence.");
  return { supabase: input.supabase, user, context, workspace: context.activeWorkspace, workspaceId: input.workspaceId, membership: context.membership };
}

export function needsBusinessEvidence(question: string, previousQuestion = "") {
  const explicitBusiness = /\b(?:our|my business|my company|workspace|company|sales|revenue|profit|inventory|kpis?|metrics?|customers?|receiving|turnaround|uploaded|notes?|memory|findings?|health|overview|integration|square|quickbooks|supplier|orders?|churn|conversion)\b/i;
  if (explicitBusiness.test(question) || (question.length < 200 && explicitBusiness.test(previousQuestion))) return true;
  const generalQuestion = question.replace(/^(?:can|could|would) you(?: please)?\s+/i, "");
  const clearlyGeneral = /^(?:write|draft|rewrite|compose|brainstorm|plan|help me (?:write|plan|organize|brainstorm|draft|rewrite|compose|understand|learn)|explain|calculate|translate|summarize this|what is|what's|who is|tell me about)\b/i.test(generalQuestion)
    || /\b(?:weather|poem|recipe|vacation|travel itinerary|current events|latest news|science|history|mathematics)\b/i.test(question);
  // Unknown metric names and questions such as 'Why did repair turnaround rise?' get retrieval.
  return !clearlyGeneral;
}
const clean = (value: unknown, max = 1500) => String(value ?? "").slice(0, max);
export function publicVsiExcerpt(sourceType: string, text: string) {
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) return clean(text, 240);
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const string = (item: unknown) => typeof item === "string" ? item : "";
    if (sourceType === "business_note") return clean(`Reported context: ${string(value.reportedContext)}`, 240);
    if (sourceType === "finding" || sourceType === "saved_analysis") return clean(string(value.summary), 240);
    if (sourceType === "business_health") return clean(string(value.overview), 240);
    if (sourceType === "kpi" || sourceType === "operational_metric") {
      const semantics = value.semantics && typeof value.semantics === "object" ? value.semantics as Record<string, unknown> : {};
      const unit = string(semantics.unit);
      const numeric = (item: unknown) => typeof item === "number" && Number.isFinite(item) ? String(item)
        : typeof item === "string" && item.length <= 80 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(item.trim()) && Number.isFinite(Number(item)) ? item.trim() : null;
      const actualValue = numeric(value.value), targetValue = numeric(value.target);
      const actual = actualValue !== null ? `${actualValue}${unit ? ` ${unit}` : ""}` : "value not recorded";
      const target = targetValue !== null ? `; target ${targetValue}${unit ? ` ${unit}` : ""}` : "";
      return clean(`${string(value.name)}: ${actual}${target}.${value.date ? ` Recorded ${string(value.date)}.` : ""}`, 240);
    }
    if (sourceType === "integration") {
      const results = Array.isArray(value.results) ? value.results as Array<Record<string, unknown>> : [];
      return clean([`${string(value.connectionState)}; ${string(value.freshness)}`, ...results.slice(0, 2).map(row => `${string(row.label)}: ${string(row.value)}. ${string(row.period)}`)].join(". "), 240);
    }
    return "";
  } catch { return ""; }
}
function relevance(question: string, text: string) {
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(term => !["the", "what", "our", "and", "why", "how", "this", "that", "business"].includes(term));
  return terms.reduce((score, term) => score + Number(text.toLowerCase().includes(term)), 0);
}

/** Authenticated client, explicit workspace predicates, existing RLS and source lifecycle on every read.
 * No admin client, external refresh, transcript indexing, embedding call or new memory store. */
export async function retrieveVsiEvidence(access: WorkspaceAccess, question: string, asOf = new Date().toISOString()): Promise<VsiEvidenceResult> {
  const { supabase, workspaceId } = access;
  const [health, memory, notes, reports] = await Promise.all([
    loadWorkspaceHealthEvidence({ supabase, workspaceId }),
    new SupabasePgvectorCandidateRetriever({ supabase }).retrieve({ version: EVIDENCE_QUERY_VERSION, workspaceId, text: question,
      requestedDomains: ["business_memory"], strategy: "keyword_only", candidateLimit: 24, resultLimit: 16, minimumSourceDiversity: 2, freshnessAfter: null }),
    loadApprovedBusinessNoteContextV1({ supabase, workspaceId, releaseChannel: businessNoteReleaseChannel(), asOf, maximumRows: 50 }),
    supabase.from("reports").select("id,title,source_data_json,created_at").eq("workspace_id", workspaceId)
      .is("deleted_at", null).is("archived_at", null).contains("source_data_json", { record_kind: "saved_analysis", release_channel: currentSavedAnalysisReleaseChannel() })
      .order("created_at", { ascending: false }).limit(30)
  ]);
  const limitations: string[] = [];
  if (health.errors.length) limitations.push("Some workspace records could not be checked. Do not interpret unavailable records as zero activity or a healthy result.");
  if (notes.error) limitations.push("Approved Business Notes could not be checked for this answer.");
  if (reports.error) limitations.push("Saved analyses could not be checked for this answer.");
  const candidates: VsiEvidence[] = [];
  const add = (sourceType: string, sourceId: string | null, title: string, text: string, evidenceDate: string | null, url: string, treatment: VsiEvidence["treatment"]) => {
    candidates.push({ id: "", title: clean(title, 180), text: clean(text, 2400), excerpt: publicVsiExcerpt(sourceType, text), sourceType, sourceId,
      evidenceDate, retrievedAt: asOf, url, treatment });
  };
  const authority = new Map<string, boolean>();
  const healthFileIds = [...new Set([
    ...[...health.kpis, ...health.operationalMetrics, ...health.crmLeads, ...health.crmHistory].flatMap(row => {
      const fileId = row.source_file_id || (row.import_id ? health.sourceParentResult.eligibility.importFileIds.get(row.import_id) : null);
      return fileId ? [fileId] : [];
    }),
    ...health.memoryChunks.flatMap(row => row.source_file_id ? [row.source_file_id] : ["file", "file_analysis"].includes(row.source_type) && row.source_id ? [row.source_id] : [])
  ])];
  for (let offset = 0; offset < healthFileIds.length; offset += 10) await Promise.all(healthFileIds.slice(offset, offset + 10).map(async fileId => {
    authority.set(fileId, (await assertDocumentExtractionAuthority({ supabase, workspaceId, fileId })).eligible);
  }));
  const excludedFileIds = new Set([...authority].filter(([, eligible]) => !eligible).map(([fileId]) => fileId));
  if (excludedFileIds.size) limitations.push("An uploaded source and its derived metrics were excluded because current extraction approval could not be verified.");
  const permittedSource = (row: { source_file_id?: string | null; import_id?: string | null }) => {
    const fileId = row.source_file_id || (row.import_id ? health.sourceParentResult.eligibility.importFileIds.get(row.import_id) : null);
    return !fileId || !excludedFileIds.has(fileId);
  };
  health.kpis = health.kpis.filter(permittedSource);
  health.intelligenceKpis = health.intelligenceKpis.filter(permittedSource);
  health.operationalMetrics = health.operationalMetrics.filter(permittedSource);
  health.intelligenceOperationalMetrics = health.intelligenceOperationalMetrics.filter(permittedSource);
  health.crmLeads = health.crmLeads.filter(permittedSource);
  health.crmHistory = health.crmHistory.filter(permittedSource);
  health.files = health.files.filter(file => !excludedFileIds.has(file.id));
  health.imports = health.imports.filter(row => !excludedFileIds.has(row.file_upload_id));
  if (health.sourceParentResult.eligibility.records) {
    health.sourceParentResult.eligibility.records.files = health.sourceParentResult.eligibility.records.files.filter(file => !excludedFileIds.has(file.id));
    health.sourceParentResult.eligibility.records.imports = health.sourceParentResult.eligibility.records.imports.filter(row => !excludedFileIds.has(row.file_upload_id));
  }
  // The same revocation gate applies to derived Health/findings, not only displayed excerpts.
  health.memoryChunks = health.memoryChunks.filter(row => {
    const fileId = row.source_file_id || (["file", "file_analysis"].includes(row.source_type) ? row.source_id : null);
    return !fileId || authority.get(fileId) === true;
  });
  const memoryCandidates = [...memory.candidates, ...health.memoryChunks.map(row => ({ candidateId: row.id, title: row.source_title,
    excerpt: row.source_excerpt, source: { sourceType: row.source_type, sourceId: row.source_id, sourceFileId: row.source_file_id }, provenance: { recordedAt: row.indexed_at } }))];
  const uniqueMemory = [...new Map(memoryCandidates.map(row => [row.candidateId, row])).values()]
    .sort((a, b) => relevance(question, `${b.title} ${b.excerpt}`) - relevance(question, `${a.title} ${a.excerpt}`)).slice(0, 20);
  // Recheck relational approval at retrieval, including an image whose extraction was later revoked.
  for (const row of uniqueMemory) {
    if (row.source.sourceType === "business_note") continue; // Canonical reviewed note context below.
    const fileId = row.source.sourceFileId || (["file", "file_analysis"].includes(row.source.sourceType) ? row.source.sourceId : null);
    if (fileId && !authority.has(fileId)) authority.set(fileId, (await assertDocumentExtractionAuthority({ supabase, workspaceId, fileId })).eligible);
    if (fileId && !authority.get(fileId)) { limitations.push("An uploaded source was excluded because its current extraction approval could not be verified."); continue; }
    add(fileId ? "file" : "business_memory", fileId || row.source.sourceId, row.title, row.excerpt, (fileId ? health.files.find(file => file.id === fileId)?.created_at : null) || row.provenance.recordedAt,
      fileId ? `/app/sources/${encodeURIComponent(fileId)}` : "/app/knowledge", "record");
  }
  for (const note of notes.error ? [] : notes.records) add("business_note", note.sourceNoteId, note.title,
    JSON.stringify({ reportedContext: note.summary, statements: note.statements, applicability: note.applicability, userAddedContext: note.userAddedContext }),
    note.observedAt || note.approvedAt, `/app/sources?note=${encodeURIComponent(note.sourceNoteId)}#business-notes`, "reported_context");
  for (const row of health.kpis) add("kpi", row.id, row.name,
    JSON.stringify({ name: row.name, value: row.actual_value, target: row.target, category: row.category, date: row.metric_date,
      notes: row.notes, sourceFileId: row.source_file_id, semantics: kpiSemantics(row.name, health.kpiSettings) }), row.metric_date, `/app/kpis?q=${encodeURIComponent(row.name)}`, "record");
  for (const row of health.operationalMetrics) add("operational_metric", row.id, row.metric_name,
    JSON.stringify({ name: row.metric_name, value: row.value, date: row.metric_date, notes: row.notes }), row.metric_date, "/app/sources", "record");
  const integrations = await loadIntegrationDashboard({ access, eligibleKpis: health.kpis });
  for (const entry of integrations.dashboard.entries.filter(entry => !entry.hidden)) add("integration", entry.key, `${entry.provider}: ${entry.name}`,
    JSON.stringify({ connectionState: entry.connectionState, freshness: entry.freshness, lastSuccessfulRefreshAt: entry.lastSuccessfulRefreshAt,
      currentUntil: entry.currentUntil, results: entry.results }), entry.lastSuccessfulRefreshAt, entry.href, "record");
  if (integrations.dashboard.unavailable.length) limitations.push(`${integrations.dashboard.unavailable.join(", ")} saved integration information is unavailable; no fresh provider sync was performed.`);
  // Same producer as Overview/Intelligence, without writing snapshots or invoking their models.
  if (!health.businessHealthSourceErrors.length && !excludedFileIds.size) {
    const operationalInsights = buildOperationalEvidenceInsights({ sourceParents: health.sourceParentResult.eligibility.records,
      kpis: health.intelligenceKpis, kpiSettings: health.intelligenceKpiSettings, operationalMetrics: health.intelligenceOperationalMetrics,
      memoryChunks: health.memoryChunks, files: health.files, imports: health.imports });
    const layer = buildIntelligenceLayer({ sourceParents: health.sourceParentResult.eligibility.records, asOf, workspace: access.workspace,
      kpis: health.intelligenceKpis, kpiSettings: health.intelligenceKpiSettings, issues: health.issues, files: health.files, imports: health.imports,
      crmLeads: health.crmLeads, sops: health.sops, forms: health.forms, submissions: health.submissions, people: health.people, decisions: health.decisions, operationalInsights });
    add("business_health", workspaceId, "Business Health and Overview", JSON.stringify({ health: layer.businessHealth, overview: layer.executiveSummary,
      quality: layer.dataQuality, forecast: layer.forecastReadiness }), asOf, "/app", "derived");
    for (const finding of layer.insights) add("finding", finding.id, finding.title, JSON.stringify({ summary: finding.summary, why: finding.why,
      confidence: finding.confidence, supportingRecords: finding.supportingRecords, contradictoryEvidence: finding.contradictoryEvidence,
      missingEvidence: finding.missingEvidence, limitation: finding.limitation }), finding.lastUpdated, `/app/intelligence?finding=${encodeURIComponent(finding.id)}`, "derived");
  }
  for (const report of reports.data || []) {
    const envelope = parseSavedAnalysisEnvelope(report.source_data_json);
    if (!envelope || envelope.workspace_id !== workspaceId || envelope.release_channel !== currentSavedAnalysisReleaseChannel()) continue;
    const lineage = envelope.evidence_lineage.length ? envelope.evidence_lineage : envelope.citations;
    const lineagePermitted = lineage.length > 0 && lineage.every(reference => reference.href && candidates.some(source =>
      source.url === reference.href && (!reference.recordedAt || source.evidenceDate?.slice(0, 10) === reference.recordedAt.slice(0, 10))));
    if (!lineagePermitted) {
      limitations.push("A saved analysis was excluded because its original sources could not all be verified as currently permitted. Check its original records before relying on that analysis.");
      continue;
    }
    add("saved_analysis", report.id, report.title, JSON.stringify({ summary: envelope.display.summary, sections: envelope.display.sections,
      freshness: envelope.freshness, evidenceStatus: envelope.display.evidence_status, confidence: envelope.confidence,
      warning: "Historical generated analysis, not independent source evidence or proof of cause." }), envelope.generated_at, `/app/reports/${encodeURIComponent(report.id)}`, "derived");
  }
  // Preserve evidence diversity, then fill by lexical relevance. Bounds are visible to the model.
  const ranked = candidates.sort((a, b) => relevance(question, `${b.title} ${b.text}`) - relevance(question, `${a.title} ${a.text}`)
    || String(b.evidenceDate).localeCompare(String(a.evidenceDate)));
  const selected: VsiEvidence[] = [];
  for (const kind of ["kpi", "business_note", "file", "finding", "saved_analysis", "integration", "business_health"]) {
    const match = ranked.find(source => source.sourceType === kind); if (match) selected.push(match);
  }
  for (const source of ranked) if (!selected.includes(source) && selected.length < 24) selected.push(source);
  let chars = 0;
  const bounded = selected.filter(source => { chars += source.text.length; return chars <= 24_000; }).map((source, index) => ({ ...source, id: `B${index + 1}` }));
  if (ranked.length > bounded.length) limitations.push("This answer uses a relevant, bounded selection of workspace records, not an exhaustive audit. Ask about a specific metric, date or file to narrow the evidence.");
  if (!bounded.length) limitations.push("No permitted matching business evidence is available for this answer.");
  return { sources: bounded, limitations: [...new Set(limitations)] };
}
