import { NextResponse } from "next/server";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import type { GlobalSearchGroup, GlobalSearchGroupLabel, GlobalSearchResult } from "@/lib/search/types";

export const dynamic = "force-dynamic";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type ChecklistRow = Database["public"]["Tables"]["checklists"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type DecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];

const GROUP_ORDER: GlobalSearchGroupLabel[] = [
  "KPIs",
  "Reports",
  "Files",
  "Issues",
  "Business Signals",
  "Review Signals",
  "CRM",
  "SOPs",
  "Checklists",
  "People",
  "Business Memory"
];

function normalizeQuery(value: string | null) {
  return (value || "").replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function queryWords(query: string) {
  return Array.from(new Set(query.toLowerCase().split(" ").filter((word) => word.length >= 2))).slice(0, 5);
}

function orFilter(fields: string[], words: string[]) {
  return fields.flatMap((field) => words.map((word) => `${field}.ilike.%${word}%`)).join(",");
}

function compact(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" · ");
}

function truncate(value: string | null | undefined, length = 170) {
  const clean = (value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "No preview available.";
  return clean.length > length ? `${clean.slice(0, length - 1).trim()}...` : clean;
}

function hrefWithQuery(path: string, value: string) {
  return `${path}?q=${encodeURIComponent(value)}`;
}

function textFromJson(value: Json | undefined, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textFromJson(item, depth + 1)).filter(Boolean).slice(0, 8).join(" ");

  return Object.entries(value)
    .filter(([key]) => !["raw_data_json", "source_data_json", "metadata_json"].includes(key))
    .map(([, item]) => textFromJson(item, depth + 1))
    .filter(Boolean)
    .slice(0, 12)
    .join(" ");
}

function matchesWords(value: string, words: string[]) {
  const haystack = value.toLowerCase();
  return words.some((word) => haystack.includes(word));
}

function addGroup(groups: Map<GlobalSearchGroupLabel, GlobalSearchResult[]>, label: GlobalSearchGroupLabel, results: GlobalSearchResult[]) {
  if (!results.length) return;
  groups.set(label, [...(groups.get(label) || []), ...results].slice(0, 6));
}

async function safeResults<T>(request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await request;
  if (error) {
    console.warn("[global-search] skipped source:", error.message);
    return [];
  }

  return data || [];
}

function sourceHref(sourceType: string | null, title: string | null) {
  const normalized = (sourceType || "").toLowerCase();
  const query = title || "";

  if (normalized.includes("task") || normalized.includes("follow")) return hrefWithQuery("/app/tasks", query);
  if (normalized.includes("issue")) return hrefWithQuery("/app/issues", query);
  if (normalized.includes("report")) return hrefWithQuery("/app/reports", query);
  if (normalized.includes("kpi")) return hrefWithQuery("/app/kpis", query);
  if (normalized.includes("file")) return hrefWithQuery("/app/files", query);
  if (normalized.includes("checklist")) return hrefWithQuery("/app/checklists", query);
  if (normalized.includes("sop")) return hrefWithQuery("/app/sops", query);
  if (normalized.includes("crm") || normalized.includes("lead")) return hrefWithQuery("/app/crm", query);

  return "/app/notifications";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q"));

  if (query.length < 2) {
    return NextResponse.json({ query, groups: [] });
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return NextResponse.json({ error: "Workspace access is required." }, { status: 403 });
  }

  const workspaceId = context.activeWorkspace.id;
  const subscriptionStatus = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId });

  if (!subscriptionStatus.allowed) {
    return NextResponse.json({ error: "Subscription access is required." }, { status: 402 });
  }

  const rateLimit = await enforceRateLimit({
    action: "global.search",
    limit: 80,
    windowSeconds: 60,
    requestHeaders: request.headers,
    userId: user.id,
    workspaceId,
    identifiers: [query],
    metadata: { source: "global_search" }
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit) }, { status: 429 });
  }

  const words = queryWords(query);
  const groups = new Map<GlobalSearchGroupLabel, GlobalSearchResult[]>();

  if (!words.length) {
    return NextResponse.json({ query, groups: [] });
  }

  const [
    kpis,
    reports,
    files,
    issues,
    tasks,
    assignments,
    crmLeads,
    sops,
    checklists,
    people,
    decisions,
    recommendations,
    vaeroexRuns
  ] = await Promise.all([
    safeResults<KpiRow>(
      supabase
        .from("kpis")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["name", "category", "notes", "source"], words))
        .order("metric_date", { ascending: false })
        .limit(6)
    ),
    safeResults<ReportRow>(
      supabase
        .from("reports")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(orFilter(["title", "report_type", "body_markdown"], words))
        .order("created_at", { ascending: false })
        .limit(6)
    ),
    safeResults<FileUploadRow>(
      supabase
        .from("file_uploads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["display_name", "original_name", "file_extension", "import_status", "processing_status", "analysis_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<IssueRow>(
      supabase
        .from("issues")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(orFilter(["title", "description", "issue_type", "severity", "status", "root_cause", "recommended_fix"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<TaskRow>(
      supabase
        .from("tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(orFilter(["title", "description", "status", "priority", "category", "assigned_role", "assigned_department"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<AssignmentRow>(
      supabase
        .from("operational_assignments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["title", "description", "status", "priority", "source_type", "source_title"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<CrmLeadRow>(
      supabase
        .from("crm_leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["lead_name", "company", "email", "status", "owner", "notes"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<SopRow>(
      supabase
        .from("sops")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(orFilter(["title", "department", "category", "body_markdown", "status"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<ChecklistRow>(
      supabase
        .from("checklists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(orFilter(["name", "description", "category", "frequency", "assigned_role"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<PersonRow>(
      supabase
        .from("people")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["full_name", "email", "phone", "role_title", "department", "status", "notes"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<DecisionRow>(
      supabase
        .from("business_decisions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["title", "reason", "expected_outcome", "related_kpi", "owner", "status", "outcome_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<RecommendationRow>(
      supabase
        .from("vaeroex_recommendation_outcomes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(orFilter(["title", "source_type", "source_title", "evidence", "related_module", "related_kpi", "expected_outcome", "owner", "priority", "status", "outcome_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    safeResults<VaeroexRunRow>(
      supabase
        .from("ai_agent_runs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(80)
    )
  ]);

  addGroup(
    groups,
    "KPIs",
    kpis.map((kpi) => ({
      id: kpi.id,
      title: kpi.name,
      sourceType: "KPI",
      preview: truncate(compact([kpi.category, kpi.notes, kpi.source])),
      href: hrefWithQuery("/app/kpis", kpi.name),
      meta: compact([kpi.metric_date, kpi.actual_value !== null ? `Actual ${kpi.actual_value}` : null, kpi.target !== null ? `Target ${kpi.target}` : null])
    }))
  );

  addGroup(
    groups,
    "Reports",
    reports.map((report) => ({
      id: report.id,
      title: report.title,
      sourceType: report.report_type,
      preview: truncate(report.body_markdown),
      href: hrefWithQuery("/app/reports", report.title),
      meta: report.created_at
    }))
  );

  addGroup(
    groups,
    "Files",
    files.map((file) => ({
      id: file.id,
      title: file.display_name || file.original_name,
      sourceType: "File",
      preview: truncate(file.analysis_summary || compact([file.file_extension, file.import_status, file.processing_status])),
      href: `/app/files?file=${encodeURIComponent(file.id)}`,
      meta: compact([file.file_extension?.toUpperCase(), file.processing_status])
    }))
  );

  addGroup(
    groups,
    "Issues",
    issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      sourceType: "Issue",
      preview: truncate(issue.description || issue.root_cause || issue.recommended_fix),
      href: hrefWithQuery("/app/issues", issue.title),
      meta: compact([issue.severity, issue.status, issue.issue_type])
    }))
  );

  addGroup(
    groups,
    "Business Signals",
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      sourceType: "Business Signal",
      preview: truncate(task.description || compact([task.category, task.related_type, task.due_date])),
      href: hrefWithQuery("/app/tasks", task.title),
      meta: compact([task.category, task.related_type, task.due_date])
    }))
  );

  addGroup(
    groups,
    "Review Signals",
    assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      sourceType: "Review Signal",
      preview: truncate(assignment.description || assignment.source_title),
      href: sourceHref(assignment.source_type, assignment.source_title || assignment.title),
      meta: compact([assignment.status, assignment.priority, assignment.due_date])
    }))
  );

  addGroup(
    groups,
    "CRM",
    crmLeads.map((lead) => ({
      id: lead.id,
      title: lead.lead_name,
      sourceType: "CRM",
      preview: truncate(compact([lead.company, lead.email, lead.notes])),
      href: hrefWithQuery("/app/crm", lead.lead_name),
      meta: compact([lead.status, lead.owner, lead.estimated_value !== null ? `$${lead.estimated_value}` : null])
    }))
  );

  addGroup(
    groups,
    "SOPs",
    sops.map((sop) => ({
      id: sop.id,
      title: sop.title,
      sourceType: "SOP",
      preview: truncate(sop.body_markdown || compact([sop.department, sop.category])),
      href: hrefWithQuery("/app/sops", sop.title),
      meta: compact([sop.status, sop.department, sop.category])
    }))
  );

  addGroup(
    groups,
    "Checklists",
    checklists.map((checklist) => ({
      id: checklist.id,
      title: checklist.name,
      sourceType: "Checklist",
      preview: truncate(checklist.description || compact([checklist.category, checklist.frequency, checklist.assigned_role])),
      href: hrefWithQuery("/app/checklists", checklist.name),
      meta: compact([checklist.category, checklist.frequency])
    }))
  );

  addGroup(
    groups,
    "People",
    people.map((person) => ({
      id: person.id,
      title: person.full_name,
      sourceType: "Person",
      preview: truncate(compact([person.email, person.phone, person.notes])),
      href: hrefWithQuery("/app/people", person.full_name),
      meta: compact([person.role_title, person.department, person.status])
    }))
  );

  const runMatches = vaeroexRuns
    .map((run) => {
      const outputText = textFromJson(run.output_json);
      return {
        run,
        outputText,
        haystack: compact([run.agent_type, run.status, run.error_message, outputText])
      };
    })
    .filter((item) => matchesWords(item.haystack, words))
    .slice(0, 4);

  addGroup(
    groups,
    "Business Memory",
    [
      ...decisions.map((decision) => ({
        id: decision.id,
        title: decision.title,
        sourceType: "Decision Journal",
        preview: truncate(decision.reason || decision.expected_outcome || decision.outcome_summary),
        href: "/app?view=Intelligence%20View",
        meta: compact([decision.status, decision.owner, decision.related_kpi])
      })),
      ...recommendations.map((recommendation) => ({
        id: recommendation.id,
        title: recommendation.title,
        sourceType: "Recommendation",
        preview: truncate(recommendation.evidence || recommendation.expected_outcome || recommendation.outcome_summary),
        href: sourceHref(recommendation.source_type, recommendation.source_title || recommendation.title),
        meta: compact([recommendation.status, recommendation.priority, recommendation.related_module])
      })),
      ...runMatches.map(({ run, outputText }) => ({
        id: run.id,
        title: run.agent_type.replace(/_/g, " "),
        sourceType: "Vaeroex Result",
        preview: truncate(outputText || run.error_message || "Saved Vaeroex result."),
        href: `/app/agents?run=${encodeURIComponent(run.id)}`,
        meta: compact([run.status, run.created_at])
      }))
    ].slice(0, 6)
  );

  const responseGroups: GlobalSearchGroup[] = GROUP_ORDER.map((label) => ({
    label,
    results: groups.get(label) || []
  })).filter((group) => group.results.length);

  return NextResponse.json({ query, groups: responseGroups });
}
