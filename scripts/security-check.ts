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
  "app/app/files/page.tsx",
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
check(openAiClient.includes("server-only"), "Vaeroex OpenAI runtime client must be marked server-only.");
check(openAiClient.includes("process.env.OPENAI_API_KEY"), "Vaeroex OpenAI runtime client must read OPENAI_API_KEY server-side.");
check(openAiClient.includes("validateAiGeneratedOutput"), "Vaeroex OpenAI runtime client must validate model output before saving.");
check(openAiClient.includes("untrusted_evidence_boundary"), "Vaeroex OpenAI runtime client must label retrieved evidence as untrusted.");

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
  "approve_crm_import",
  "approve_operational_metrics_import",
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
check(fileActions.includes("approve_crm_import"), "CRM import approval must pass through the gateway.");
check(fileActions.includes("approve_operational_metrics_import"), "Operational metrics import approval must pass through the gateway.");
check(fileActions.includes("create_report_from_file"), "Report-from-file generation must pass through the gateway.");
check(fileActions.includes("attach_file_to_report"), "File-to-report attachment must pass through the gateway.");
check(fileActions.includes("save_file_analysis_business_memory"), "Saving file analysis to Business Memory must pass through the gateway.");

const operationsActions = read("app/app/operations/actions.ts");
check(operationsActions.includes("update_kpi_record") && operationsActions.includes("delete_kpi_record"), "KPI edits/deletes must pass through the gateway.");
check(operationsActions.includes("update_kpi_settings"), "KPI configuration edits must pass through the gateway.");
check(operationsActions.includes("business_signal_delete"), "Business Memory/Signal deletion must be audited through the gateway.");

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
