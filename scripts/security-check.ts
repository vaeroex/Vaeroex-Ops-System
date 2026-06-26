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
  "docs/security/final-security-report.md"
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
  "lib/security/types.ts"
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
  "manual_activation_requests"
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
