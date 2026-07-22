const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath: string) {
  return existsSync(path.join(root, relativePath));
}

function walk(relativePath: string, extensions = [".ts", ".tsx"]): string[] {
  const absolutePath = path.join(root, relativePath);

  if (!existsSync(absolutePath)) {
    return [] as string[];
  }

  return readdirSync(absolutePath).flatMap((entry: string) => {
    const child = path.join(absolutePath, entry);
    const childRelative = path.relative(root, child);

    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      return [];
    }

    if (statSync(child).isDirectory()) {
      return walk(childRelative, extensions);
    }

    return extensions.includes(path.extname(entry)) ? [childRelative] : [];
  });
}

function check(condition: boolean, message: string) {
  if (!condition) {
    failures.push(message);
  }
}

function warn(condition: boolean, message: string) {
  if (!condition) {
    warnings.push(message);
  }
}

const sourceFiles = ["app", "components", "lib", "scripts"].flatMap((folder) => walk(folder));
const migrationFiles = walk("supabase/migrations", [".sql"]);
const allMigrationsSql = migrationFiles.map(read).join("\n\n").toLowerCase();

const expectedDocs = [
  "docs/security/route-access-audit.md",
  "docs/security/rls-audit.md",
  "docs/security/secrets-audit.md",
  "docs/security/storage-audit.md",
  "docs/security/demo-isolation-audit.md",
  "docs/security/admin-access-audit.md",
  "docs/security/manual-security-test-plan.md",
  "docs/security/permission-matrix.md",
  "docs/security/customer-data-safety.md",
  "docs/security/final-security-report.md",
  "docs/security/ai-tool-execution-safety.md",
  "docs/security/ai-app-mutation-gap-closure-report.md"
];

for (const doc of expectedDocs) {
  check(exists(doc), `Missing required security document: ${doc}`);
}

const requiredSecurityHelpers = [
  "lib/security/require-auth.ts",
  "lib/security/require-workspace-access.ts",
  "lib/security/require-workspace-role.ts",
  "lib/security/require-vaeroex-admin.ts",
  "lib/security/require-active-subscription.ts",
  "lib/security/assert-workspace-scope.ts",
  "lib/security/get-current-workspace.ts",
  "lib/security/types.ts",
  "lib/security/tool-execution-gateway.ts",
  "lib/security/ai-output-validation.ts"
];

for (const helper of requiredSecurityHelpers) {
  check(exists(helper), `Missing reusable security helper: ${helper}`);
}

const tenantTables = [
  "business_intakes",
  "workflow_maps",
  "forms",
  "form_submissions",
  "checklists",
  "checklist_runs",
  "tasks",
  "issues",
  "assets",
  "asset_checks",
  "people",
  "sops",
  "reports",
  "ai_agent_runs",
  "notifications",
  "audit_logs",
  "kpis",
  "record_folders",
  "file_uploads",
  "file_imports",
  "file_import_rows",
  "crm_leads",
  "crm_lead_history",
  "operational_metrics",
  "record_shares",
  "operational_assignments",
  "kpi_alert_rules",
  "kpi_alert_events",
  "report_subscription_preferences",
  "scheduled_report_runs",
  "business_decisions",
  "vaeroex_recommendation_outcomes",
  "support_requests",
  "customer_subscriptions",
  "subscription_events",
  "ai_usage",
  "manual_activation_requests",
  "business_health_snapshots",
  "security_audit_events"
];

function migrationMentionsTable(table: string) {
  return allMigrationsSql.includes(`public.${table}`) || allMigrationsSql.includes(`'${table}'`);
}

function hasRls(table: string) {
  return (
    new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(allMigrationsSql) ||
    (allMigrationsSql.includes(`'${table}'`) && allMigrationsSql.includes("enable row level security', table_name"))
  );
}

function hasPolicy(table: string) {
  return (
    new RegExp(`create\\s+policy[\\s\\S]+on\\s+public\\.${table}`, "i").test(allMigrationsSql) ||
    (allMigrationsSql.includes(`'${table}'`) && allMigrationsSql.includes("create policy") && allMigrationsSql.includes("workspace_id"))
  );
}

for (const table of tenantTables) {
  check(migrationMentionsTable(table), `Expected tenant/admin table is missing from migrations: ${table}`);
  check(hasRls(table), `RLS enable statement not found for table: ${table}`);
  check(hasPolicy(table), `Policy definition not found for table: ${table}`);
}

const storageMigration = read("supabase/migrations/202606180004_files_imports.sql");
check(storageMigration.includes("'workspace-files'"), "workspace-files bucket is missing from storage migration.");
check(storageMigration.includes("false"), "workspace-files bucket must be private.");
check(storageMigration.includes("split_part(name, '/', 1)") && storageMigration.includes("public.is_workspace_member"), "Storage policies must scope object paths by workspace membership.");
check(storageMigration.includes("public.can_edit_operations"), "Storage delete policy must require workspace edit permission.");

const adminLayout = read("app/app/admin/layout.tsx");
check(adminLayout.includes("requireVaeroexAdmin"), "Admin layout must require Vaeroex admin access server-side.");

const adminActions = [
  "app/app/admin/subscriptions/actions.ts",
  "app/app/admin/support-requests/actions.ts",
  "app/app/admin/workspaces/actions.ts"
];

for (const file of adminActions) {
  check(read(file).includes("requireVaeroexAdmin"), `${file} must call requireVaeroexAdmin.`);
}

const customerPages = [
  "app/app/page.tsx",
  "app/app/reports/page.tsx",
  "app/app/sops/page.tsx",
  "app/app/kpis/page.tsx",
  "app/app/crm/page.tsx",
  "app/app/tasks/page.tsx",
  "app/app/checklists/page.tsx",
  "app/app/issues/page.tsx",
  "app/app/assets/page.tsx",
  "app/app/people/page.tsx",
  "app/app/forms/page.tsx",
  "app/app/form-submissions/page.tsx",
  "app/app/notifications/page.tsx",
  "app/app/agents/page.tsx"
];

for (const file of customerPages) {
  check(read(file).includes("requireWorkspacePage"), `${file} must call requireWorkspacePage for authenticated workspace access.`);
}

const legacyFilesPage = read("app/app/files/page.tsx");
check(legacyFilesPage.includes("permanentRedirect") && legacyFilesPage.includes("/app/sources"), "Legacy Files must redirect into the authenticated Evidence workspace without querying data.");

const pendingSubmitButton = read("components/operations/PendingSubmitButton.tsx");
check(pendingSubmitButton.includes("useFormStatus"), "PendingSubmitButton must keep React form-status awareness for server action submissions.");
check(pendingSubmitButton.includes("useActivitySignal(!activityDisabled && showingPending"), "PendingSubmitButton must support scoped global loading cursor registration.");
check(pendingSubmitButton.includes("const showingPending = pending || localPending"), "PendingSubmitButton must combine form pending and local pending state.");
check(pendingSubmitButton.includes("setLocalPending(true)"), "PendingSubmitButton must set local pending immediately when a submit starts.");
check(!pendingSubmitButton.includes("setTimeout(() => setLocalPending(true)"), "PendingSubmitButton must not delay local pending state with setTimeout.");
check(!pendingSubmitButton.includes("onClick={"), "PendingSubmitButton must not set pending from a pre-submit click handler that can race native form submission.");
check(pendingSubmitButton.includes("disabled={disabled || showingPending}"), "PendingSubmitButton must disable itself while a submission is pending.");
check(pendingSubmitButton.includes("pointer-events-none opacity-70"), "PendingSubmitButton must visually fade and suppress hover while pending.");
check(pendingSubmitButton.includes("{showingPending ? pendingLabel : children}"), "PendingSubmitButton must swap its label to the pending label while generating.");

const agentsPage = read("app/app/agents/page.tsx");
const appShell = read("components/app/AppShell.tsx");
const globalSearch = read("components/app/GlobalSearch.tsx");
const globalSearchTrigger = read("components/app/GlobalSearchTrigger.tsx");
const searchRoute = read("app/api/search/route.ts");
const legacyAskPage = read("app/app/ask/page.tsx");
const askWorkspace = read("components/app/AskVaeroexWorkspace.tsx");
const askResponse = read("components/app/AskVaeroexResponse.tsx");
const askSession = read("lib/search/ask-session.ts");
const askSessionToken = read("lib/search/ask-session-token.ts");
check(appShell.includes('href: "/app/ask"') && appShell.includes('label: "Ask Vaeroex"'), "Ask Vaeroex must have a dedicated authenticated navigation destination.");
check(appShell.includes("GlobalSearch"), "The authenticated shell must preserve the separate global Search overlay.");
check(globalSearch.includes("Search workspace") && globalSearch.includes("vaeroex:open-global-search"), "Global Search must remain a Search-only in-place panel.");
check(globalSearch.includes("openSelectedResult") && globalSearch.includes("/api/search?q="), "Global Search Enter must navigate deterministic GET results.");
check(!globalSearch.includes('method: "POST"') && !globalSearch.includes("ExecutiveIntelligenceAnswer"), "Global Search must not retain Ask generation or business-answer state.");
check(globalSearch.includes("SecurityResponseNotice") && globalSearch.includes('payload.answer?.kind === "security_response"'), "Global Search must preserve the minimal Security Response for blocked deterministic lookups.");
check(globalSearchTrigger.includes("vaeroex:open-global-search"), "Page-level Search buttons must continue opening the global Search panel.");
check(askWorkspace.includes('fetch("/api/search"') && askWorkspace.includes('method: "POST"'), "The dedicated Ask workspace must own explicit model-backed generation.");
check(askWorkspace.includes("requestInFlightRef.current") && askWorkspace.includes("requestControllerRef"), "The dedicated Ask workspace must prevent duplicate POSTs and cancel safely.");
check(askResponse.includes("SecurityResponseNotice") && askResponse.includes("ExecutiveIntelligenceAnswer"), "Dedicated Ask must render security blocks separately and preserve Executive Intelligence output.");
check(askSession.includes("ASK_MAX_FOLLOW_UPS = 5") && askSession.includes("ASK_SESSION_INACTIVITY_MS = 60 * 60 * 1000"), "Persistent Ask sessions must enforce five follow-ups and a 60-minute inactivity expiry.");
check(askSessionToken.includes("createHmac") && askSessionToken.includes("workspaceId") && askSessionToken.includes("userId"), "Follow-up authority must be server-signed and bound to workspace and user.");
check(searchRoute.includes("classifySecurityIntent") && searchRoute.includes('kind: "security_response"'), "Global Search or Ask must classify security-sensitive prompts before returning search or business answers.");
check(searchRoute.includes("buildKpiGlobalAnswer") && searchRoute.includes("runVaeroexCompletionWithUsage"), "Dedicated Ask must support bounded structured and provider-backed business answers.");
check(!searchRoute.includes("shouldBuildAnswer") && !searchRoute.includes("buildGeneralBusinessAnswer"), "GET Search must not retain hidden business-answer generation work.");
check(searchRoute.includes("planVaeroexQuery") && searchRoute.includes("scopedResults"), "Global Search or Ask must plan data domains and avoid querying unrelated sources.");
check(searchRoute.includes("export async function POST") && searchRoute.includes("buildBoundedWorkspaceContext"), "Explicit global questions must use bounded planner-selected context.");
check(searchRoute.includes("loadKpiOverviewData") && searchRoute.includes("shouldUseKpiOverviewAnswer"), "Global Search or Ask must route KPI overview through the shared KPI/settings loader with a narrow intent gate.");
check(!/kpiOverviewIntent\.matched\s*\|\|\s*\/\\b\(kpi\|kpis\|metric\|metrics\|weakest/.test(searchRoute), "Global Search or Ask must not route generic weakest questions into KPI overview.");
check(searchRoute.includes("business_memory_chunks") && searchRoute.includes('"Learned Knowledge"'), "Global Search or Ask must search active Learned Knowledge instead of implementation-only result records.");
check(searchRoute.includes("shouldSearchDiagnostics") && searchRoute.includes("isVaeroexAdminUser"), "Global Search or Ask must keep execution diagnostics admin-explicit.");
check(!/sourceType:\s*"Vaeroex Result"/.test(searchRoute), "Global Search or Ask must not expose Vaeroex Result records as ordinary customer-facing knowledge.");
check(legacyAskPage.includes("AskVaeroexWorkspace") && legacyAskPage.includes("params.run"), "Dedicated /app/ask must render persistent analysis while preserving saved legacy result links.");
check(agentsPage.includes('redirect("/app/ask")') && agentsPage.includes("Saved Vaeroex Result"), "Blank legacy /app/agents visits must open the dedicated Ask destination while saved runs remain readable.");
check(agentsPage.includes("canViewDebug ?") && agentsPage.includes("Admin result records"), "Legacy Vaeroex result records must be admin/debug-only outside bookmarked saved runs.");
check(agentsPage.includes("PendingSubmitButton") && agentsPage.includes('pendingLabel="Generating..."'), "Ask Vaeroex must use PendingSubmitButton with a Generating... pending label.");
check(agentsPage.includes("data-vaeroex-skip-global-activity={workflow.key === \"ask_vaeroex\""), "Ask Vaeroex form must bypass the document-level global activity submit listener.");
check(agentsPage.includes("activityDisabled={workflow.key === \"ask_vaeroex\""), "Ask Vaeroex must bypass button-level global activity cursor registration while preserving local pending text.");
check(agentsPage.includes("Direct Answer") && agentsPage.includes("Evidence Note") && agentsPage.includes("Recommendation Confidence") && agentsPage.includes("Show Supporting Evidence"), "Ask Vaeroex must use direct-answer mode with confidence and collapsed supporting evidence.");
check(agentsPage.includes("hasWorkspaceKnowledge") && agentsPage.includes("questionCoverage"), "Ask Vaeroex must distinguish workspace knowledge from question-specific evidence coverage.");
check(!agentsPage.includes("Evidence Summary") && !agentsPage.includes("Vaeroex answered"), "Ask Vaeroex must not regress to report-style Evidence Summary or Vaeroex answered labels.");
check(!agentsPage.includes("Generate Executive Strategy") && !agentsPage.includes("Create Improvement Plan"), "Ask Vaeroex direct-answer mode must not preemptively show generated-output action buttons.");

const agentsActionsRuntime = read("app/app/agents/actions.ts");
check(agentsActionsRuntime.includes("ASK_VAEROEX_MEMORY_RETRIEVAL_TIMEOUT_MS"), "Ask Vaeroex must bound Business Memory retrieval so server actions can return.");
check(agentsActionsRuntime.includes("withStageTimeout") && agentsActionsRuntime.includes("Business Memory retrieval"), "Ask Vaeroex must apply a stage timeout to Business Memory retrieval.");
check(agentsActionsRuntime.includes("reducedEvidenceContext") && agentsActionsRuntime.includes("continuingWithReducedContext"), "Ask Vaeroex must continue with reduced context when Business Memory retrieval fails safely.");
check(agentsActionsRuntime.includes("askVaeroexProviderSettings") && agentsActionsRuntime.includes("providerSettings"), "Ask Vaeroex must cap provider timeout/retry settings for server-action execution.");
check(agentsActionsRuntime.includes("createRunningRun") && agentsActionsRuntime.includes('status: "running"'), "Ask Vaeroex must create a run record before long-running analysis starts.");
check(agentsActionsRuntime.includes("updateRunRecord") && agentsActionsRuntime.includes("failureOutput"), "Ask Vaeroex must update the same run for success, timeout, and failure outcomes.");
check(agentsActionsRuntime.includes("vaeroex_run_diagnostics") && agentsActionsRuntime.includes("finalStage"), "Ask Vaeroex failed runs must store admin-only lifecycle diagnostics.");
check(agentsActionsRuntime.includes("classifySecurityIntent") && agentsActionsRuntime.includes("security_intent_classified"), "Ask Vaeroex must classify security intent before Business Memory and OpenAI generation.");
check(agentsActionsRuntime.indexOf("classifySecurityIntent") < agentsActionsRuntime.indexOf("business_memory"), "Ask Vaeroex security intent classification must run before Business Memory retrieval.");
check(agentsActionsRuntime.includes("classifyKpiOverviewIntent") && agentsActionsRuntime.includes("runLightweightKpiOverview"), "Ask Vaeroex must route simple KPI overview prompts through the lightweight KPI workflow.");
check(!agentsActionsRuntime.includes("buildWorkspaceSnapshot") && agentsActionsRuntime.includes("buildBoundedWorkspaceContext"), "Ask Vaeroex must use bounded planned context instead of a full workspace snapshot.");
check(agentsActionsRuntime.includes("executionPlanForWorkflow") && agentsActionsRuntime.includes("query_plan"), "Ask Vaeroex must record and enforce a server-side query-depth plan.");
const kpiOverviewRuntime = read("lib/ai/kpi-overview.ts");
check(kpiOverviewRuntime.includes("KPI_OVERVIEW_MAX_ROWS") && kpiOverviewRuntime.includes("KPI_OVERVIEW_HISTORY_PER_METRIC"), "KPI overview must cap historical KPI context.");
check(kpiOverviewRuntime.includes("loadKpiOverviewData") && kpiOverviewRuntime.includes("kpi_settings"), "KPI overview must load workspace KPI settings through a shared bounded helper.");
check(kpiOverviewRuntime.includes("Business Memory or document retrieval") && kpiOverviewRuntime.includes("retrieval_ms"), "KPI overview must distinguish structured KPI evidence from broad retrieval.");
check(kpiOverviewRuntime.includes("maxRetries: 0"), "KPI overview provider retry must avoid repeating an identical expensive request.");
const vaeroexClientRuntime = read("lib/ai/vaeroex-client.ts");
check(vaeroexClientRuntime.includes("providerSettings?: AIProviderRetrySettings"), "Vaeroex client must accept per-call provider timeout/retry settings.");
check(vaeroexClientRuntime.includes("token_budget_check_started") && vaeroexClientRuntime.includes("token_budget_check_finished"), "Vaeroex provider client must log token budget stages.");
check(vaeroexClientRuntime.includes("modelRoute") && vaeroexClientRuntime.includes("executionPath"), "Vaeroex OpenAI usage must identify model route and execution path.");
check(vaeroexClientRuntime.includes("collectBoundedSourceIds") && vaeroexClientRuntime.includes("allowedSourceIds"), "Vaeroex output citations must be validated against bounded request evidence.");
const contextualAskRuntime = read("app/app/contextual-ask/actions.ts");
check(!contextualAskRuntime.includes("buildWorkspaceSnapshot") && contextualAskRuntime.includes("buildFocusedExplanationContext"), "Contextual explanations must use selected-item context instead of a broad workspace snapshot.");
check(contextualAskRuntime.includes('retrievalStrategy: "keyword_only"') && contextualAskRuntime.includes("maxEvidenceChunks"), "Contextual explanations must use bounded low-cost evidence retrieval.");
const usageRuntime = read("lib/ai/usage.ts");
check(usageRuntime.includes("CONSERVATIVE_UNKNOWN_MODEL_COST_CENTS_PER_1M") && !usageRuntime.includes("{ input: 0, output: 0 }"), "Unknown OpenAI models must never record zero estimated cost.");
const evidenceIndexRuntime = read("lib/ai/evidence-index.ts");
check(
  evidenceIndexRuntime.includes("embeddingTimeoutMs") && evidenceIndexRuntime.includes("createAIEmbeddings") && read("lib/ai/providers/provider-manager.ts").includes("maxRetries: 0"),
  "Semantic retrieval must have a bounded timeout and avoid repeated embedding requests."
);

const workspaceActionFiles = [
  "app/app/operations/actions.ts",
  "app/app/files/actions.ts",
  "app/app/agents/actions.ts",
  "app/app/reports/actions.ts",
  "app/app/accountability/actions.ts",
  "app/app/report-subscriptions/actions.ts",
  "app/app/intelligence/actions.ts"
];

for (const file of workspaceActionFiles) {
  const content = read(file);
  check(content.includes("requireWorkspace"), `${file} must call a workspace guard before mutations.`);
  check(content.includes("workspaceId"), `${file} must carry workspaceId through mutations.`);
}

const fileActions = read("app/app/files/actions.ts");
check(fileActions.includes("getFileForWorkspace") && fileActions.includes('.eq("workspace_id", workspaceId)'), "File actions must read files through workspace-scoped lookup.");
check(fileActions.includes("storagePath = `${workspaceId}/"), "Uploaded file storage paths must start with workspaceId.");

const demoActions = read("app/app/demo/actions.ts");
check(demoActions.includes("subscription_status: \"demo\""), "Demo workspace creation must mark workspaces as demo.");
check(demoActions.includes("ensureDemoWorkspacePopulated"), "Demo workspace actions must populate isolated demo data.");
check(demoActions.includes("isVaeroexAdminUser"), "Demo reset/fresh actions must require Vaeroex admin access.");

const supportActions = read("app/support/actions.ts");
check(supportActions.includes(".from(\"workspace_members\")") && supportActions.includes(".eq(\"user_id\", user.id)"), "Support requests must validate workspace membership before storing workspace_id.");
check(supportActions.includes("support.create_request") && supportActions.includes("logSecurityAuditEvent"), "Support/contact request creation must write security audit events.");

const clientFiles = sourceFiles.filter((file) => read(file).startsWith("\"use client\"") || read(file).startsWith("'use client'"));
const serverSecrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET"
];

for (const file of clientFiles) {
  const content = read(file);
  for (const secret of serverSecrets) {
    check(!content.includes(secret), `${file} is a client component and must not reference ${secret}.`);
  }
  check(!content.includes("@/lib/supabase/admin"), `${file} must not import the service-role Supabase client.`);
  check(!content.includes("@/lib/ai/vaeroex-client"), `${file} must not import the server-only Vaeroex runtime client.`);
}

const adminClient = read("lib/supabase/admin.ts");
check(adminClient.includes("server-only"), "Service-role Supabase admin client must be marked server-only.");
check(adminClient.includes("SUPABASE_SERVICE_ROLE_KEY"), "Service-role Supabase admin client should be the only place that reads SUPABASE_SERVICE_ROLE_KEY directly.");

const openAiClient = read("lib/ai/vaeroex-client.ts");
const openAiProvider = read("lib/ai/providers/openai-provider.ts");
const nvidiaProvider = read("lib/ai/providers/nvidia-provider.ts");
const providerManager = read("lib/ai/providers/provider-manager.ts");
check(openAiClient.includes("server-only"), "Vaeroex runtime client must be marked server-only.");
check(openAiProvider.includes("server-only") && openAiProvider.includes("process.env.OPENAI_API_KEY"), "OpenAI provider must read OPENAI_API_KEY server-side.");
check(nvidiaProvider.includes("server-only") && nvidiaProvider.includes("process.env.NVIDIA_API_KEY"), "NVIDIA provider must read NVIDIA_API_KEY server-side.");
check(providerManager.includes("OpenAIProvider") && providerManager.includes("NvidiaProvider"), "Vaeroex generation must use the provider manager abstraction.");
check(openAiClient.includes("validateAiGeneratedOutput"), "Vaeroex runtime client must validate model output before saving.");
check(openAiClient.includes("untrusted_evidence_boundary"), "Vaeroex runtime client must label retrieved evidence as untrusted.");

const toolGateway = read("lib/security/tool-execution-gateway.ts");
check(toolGateway.includes("server-only"), "AI tool execution gateway must be server-only.");
check(toolGateway.includes("TOOL_EXECUTION_REGISTRY"), "AI tool execution gateway must use an explicit allowlist registry.");
check(toolGateway.includes("z.object"), "AI tool execution gateway must validate tool arguments with schemas.");
check(toolGateway.includes("allowedRoles"), "AI tool execution gateway must enforce workspace role permissions.");
check(toolGateway.includes("requiresConfirmation"), "AI tool execution gateway must enforce confirmation metadata.");
check(toolGateway.includes("security_audit_events"), "AI tool execution gateway must write audit events.");
check(toolGateway.includes("delete_generated_insights"), "AI tool execution gateway must guard generated insight deletion.");
for (const toolName of [
  "stage_file_import",
  "approve_kpi_import",
  "approve_operational_metrics_import",
  "approve_workbook_import",
  "create_report_from_file",
  "attach_file_to_report",
  "save_file_analysis_business_memory",
  "update_kpi_record",
  "update_kpi_settings",
  "delete_kpi_record",
  "manage_record",
  "archive_record",
  "delete_record",
  "bulk_manage_records"
]) {
  check(toolGateway.includes(toolName), `AI tool execution gateway must register mutation path: ${toolName}.`);
}
check(toolGateway.includes("Bulk record deletion requires typed DELETE confirmation"), "Bulk destructive record actions must require typed DELETE confirmation.");
check(toolGateway.includes("recentBlockedActionCount"), "Gateway must rate-limit repeated blocked or suspicious actions.");
check(toolGateway.includes("unsafeInstructionPattern"), "Gateway must reject raw SQL and prompt-injection-like tool arguments.");

const securityEventsMigration = read("supabase/migrations/202607080003_security_audit_service_events.sql");
check(securityEventsMigration.includes("alter column workspace_id drop not null"), "Service/system security audit migration must allow workspace-pending events.");
check(securityEventsMigration.includes("security_audit_events_created_idx"), "Security audit migration must add a created_at index for admin review.");

const recordManagementActions = read("app/app/operations/record-management-actions.ts");
check(recordManagementActions.includes("bulk_manage_records"), "Managed record bulk mutations must pass through the gateway.");
check(recordManagementActions.includes("typed_confirmation"), "Managed record bulk delete UI/action must carry typed DELETE confirmation.");
check(recordManagementActions.includes("delete_record") && recordManagementActions.includes("archive_record"), "Managed record destructive actions must use delete/archive gateway tools.");

const managedRecordList = read("components/operations/ManagedRecordList.tsx");
check(managedRecordList.includes("Type DELETE for bulk delete"), "Bulk delete form must require visible typed DELETE confirmation.");
const archivedBulkActions = read("components/operations/ArchivedFilesBulkActions.tsx");
check(archivedBulkActions.includes("Type DELETE") && archivedBulkActions.includes("typed_confirmation"), "Archived file bulk delete must require typed DELETE confirmation.");

check(fileActions.includes("stage_file_import"), "File import staging must pass through the gateway.");
check(fileActions.includes("approve_kpi_import"), "KPI import approval must pass through the gateway.");
check(fileActions.includes("approve_operational_metrics_import"), "Operational metrics import approval must pass through the gateway.");
check(fileActions.includes("approve_workbook_import"), "Multi-dataset workbook approval must pass through the gateway.");
check(!fileActions.includes("\"approve_crm_import\""), "Retired customer-record imports must not call the CRM import approval tool.");
check(fileActions.includes("Customer record imports have been retired"), "Customer-record imports must fail closed with a clear retired-workflow message.");
check(fileActions.includes("create_report_from_file"), "Report-from-file generation must pass through the gateway.");
check(fileActions.includes("attach_file_to_report"), "File-to-report attachment must pass through the gateway.");
check(fileActions.includes("save_file_analysis_business_memory"), "Saving file analysis to Business Memory must pass through the gateway.");

const operationsActions = read("app/app/operations/actions.ts");
check(operationsActions.includes("update_kpi_record") && operationsActions.includes("delete_kpi_record"), "KPI edits/deletes must pass through the gateway.");
check(operationsActions.includes("update_kpi_settings"), "KPI configuration edits must pass through the gateway.");
check(!operationsActions.includes("deleteBusinessSignalAction") && !operationsActions.includes('.from("tasks")'), "Retired Business Signal mutations must be removed from customer actions.");

const sourcesActions = read("app/app/sources/actions.ts");
check(sourcesActions.includes("delete_generated_insights"), "Generated insight deletion must pass through the gateway.");
check(sourcesActions.includes("business_memory_chunks") && sourcesActions.includes("deleted_at") && sourcesActions.includes("archived_at"), "Deleted generated insights must be excluded from Business Memory retrieval.");

const stripeWebhook = read("app/api/stripe/webhook/route.ts");
check(stripeWebhook.includes("logSecurityAuditEvent") && stripeWebhook.includes("stripe."), "Stripe webhook processing must write security audit events.");
const demoAdminActions = read("app/app/demo/actions.ts");
check(demoAdminActions.includes("admin.reset_demo_workspace") && demoAdminActions.includes("admin.create_fresh_demo_workspace"), "Admin demo reset/create actions must write security audit events.");
const adminWorkspaceActions = read("app/app/admin/workspaces/actions.ts");
check(adminWorkspaceActions.includes("admin.update_workspace_access"), "Admin workspace access updates must write security audit events.");
const adminSubscriptionActions = read("app/app/admin/subscriptions/actions.ts");
check(adminSubscriptionActions.includes("admin.update_subscription") && adminSubscriptionActions.includes("admin.create_manual_subscription"), "Admin subscription mutations must write security audit events.");
const adminSupportActions = read("app/app/admin/support-requests/actions.ts");
check(adminSupportActions.includes("admin.update_support_request") && adminSupportActions.includes("admin_support_request_action"), "Admin support request mutations must write security audit events.");

const adminAuditPage = read("app/app/admin/audit-logs/page.tsx");
check(adminAuditPage.includes("security_audit_events") && adminAuditPage.includes("Security events"), "Admin audit page must show security audit events.");

const evidenceIndex = read("lib/ai/evidence-index.ts");
check(evidenceIndex.toLowerCase().includes("untrusted data"), "Evidence retrieval policy must treat retrieved chunks as untrusted data.");

const outputValidation = read("lib/security/ai-output-validation.ts");
check(outputValidation.includes("validateAiGeneratedOutput"), "AI output validation helper must expose validateAiGeneratedOutput.");
check(outputValidation.includes("FORBIDDEN_OUTPUT_PATTERNS"), "AI output validation helper must define forbidden output patterns.");
check(outputValidation.includes("SOURCE_REFERENCE_KEYS") && outputValidation.includes("UUID_PATTERN"), "AI output validation must validate source citation record IDs.");

const evidenceEligibility = read("lib/intelligence/evidence-eligibility.ts");
check(evidenceEligibility.includes("classifyEvidenceEligibility") && evidenceEligibility.includes("filterBusinessEvidence"), "Business derivations must use a centralized evidence lifecycle classifier.");
check(evidenceEligibility.includes("platform_telemetry") && evidenceEligibility.includes("platform_failure"), "Platform telemetry and failures must be classified separately from business evidence.");
check(evidenceEligibility.includes("user_failure_state") && evidenceEligibility.includes("invalid_evidence"), "Evidence classification must distinguish user failure state and invalid evidence.");
const intelligenceLayer = read("lib/intelligence/layer.ts");
const intelligenceCoverage = read("lib/intelligence/coverage.ts");
check(intelligenceLayer.includes("filterOriginalBusinessEvidence") && intelligenceLayer.includes("available: hasHealthEvidence"), "Only original evidence may produce intelligence risks or a Business Health score.");
check(intelligenceCoverage.includes("filterOriginalBusinessEvidence") && intelligenceCoverage.includes("uniqueSources") && !intelligenceCoverage.includes('label: "Vaeroex Memory"'), "Derived runs and chunks must not inflate coverage or Source Mix.");
check(contextualAskRuntime.includes("sanitizeBusinessEvidenceText") && contextualAskRuntime.includes("eligibleEvidenceChunks"), "Contextual explanations must sanitize platform failures and reject ineligible retrieved evidence.");
const dashboardRuntime = read("app/app/page.tsx");
check(dashboardRuntime.includes("businessHealthSourceErrors") && dashboardRuntime.includes("intelligenceLayer.businessHealth.available"), "Business Health snapshots must not persist when required source queries fail or evidence is insufficient.");
const evidenceRetrievalMigration = read("supabase/migrations/202607110001_business_memory_evidence_eligibility.sql");
check(evidenceRetrievalMigration.includes("left join public.file_uploads source_file") && evidenceRetrievalMigration.includes("left join public.ai_agent_runs source_run"), "Vector retrieval must validate source file and source run lifecycle before limiting evidence.");
check(evidenceRetrievalMigration.includes("security invoker") && evidenceRetrievalMigration.includes("public.is_workspace_member"), "Evidence retrieval migration must preserve invoker security and workspace authorization.");

const rawDebugFiles = sourceFiles.filter((file) => {
  const content = read(file);
  return content.includes("JsonPreview") || content.includes("DebugData") || content.includes("debugMode");
});

for (const file of rawDebugFiles) {
  const content = read(file);
  warn(content.includes("canViewDebug") || content.includes("requireVaeroexAdmin") || content.includes("enabled={canViewDebug"), `${file} contains debug rendering; verify it is admin/debug gated.`);
}

if (warnings.length) {
  console.warn("Security check warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (failures.length) {
  console.error("Security check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Security check passed.");
