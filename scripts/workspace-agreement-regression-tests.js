const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const agreement = read("lib/legal/workspace-agreement.ts");
const schema = read("lib/legal/workspace-agreement-schema.ts");
const record = read("lib/legal/workspace-agreement-record.ts");
const pdf = read("lib/legal/workspace-agreement-pdf.ts");
const email = read("lib/email/workspace-agreement.ts");
const adminEmail = read("lib/email/workspace-agreement-admin.ts");
const form = read("components/setup/WorkspaceCreationForm.tsx");
const setupPage = read("app/app/setup/page.tsx");
const setupAction = read("app/app/setup/actions.ts");
const migration = read("supabase/migrations/202607250002_workspace_agreements.sql");
const adminEmailMigration = read("supabase/migrations/20260726205442_workspace_agreement_admin_email_delivery.sql");
const sources = read("app/app/sources/page.tsx");
const agreementList = read("components/legal/WorkspaceAgreementList.tsx");
const customerPage = read("app/app/legal/agreements/[agreementId]/page.tsx");
const customerPdf = read("app/api/legal/workspace-agreements/[agreementId]/pdf/route.ts");
const adminPage = read("app/app/admin/workspace-agreements/page.tsx");
const adminDetail = read("app/app/admin/workspace-agreements/[agreementId]/page.tsx");
const adminActions = read("app/app/admin/workspace-agreements/actions.ts");
const adminPdf = read("app/api/admin/workspace-agreements/[agreementId]/pdf/route.ts");
const appShell = read("components/app/AppShell.tsx");
const adminNav = read("components/admin/AdminNav.tsx");
const adminWorkspaces = read("app/app/admin/workspaces/page.tsx");
const adminCustomers = read("app/app/admin/customers/page.tsx");
const adminCompanyTable = read("components/admin/AdminCompanyTable.tsx");
const adminWorkspaceTable = read("components/admin/AdminWorkspaceQueueTable.tsx");
const adminCompanyDetail = read("app/app/admin/customers/[workspaceId]/page.tsx");
const nextConfig = read("next.config.mjs");

assert.equal(exists("components/setup/SetupWizard.tsx"), false, "the multi-step setup wizard must be removed");
assert.equal(exists("data/workspace-categories.ts"), false, "questionnaire workspace categories must be removed");
assert.match(setupPage, /WorkspaceCreationForm/, "setup must render the one-page workspace form");
assert.doesNotMatch(setupPage, /SetupWizard|Clarity|Context|Generate/, "setup must not render the retired interview steps");

for (const label of [
  "Organization Name",
  "Workspace Owner Full Legal Name",
  "Workspace Owner Job Title",
  "Workspace Owner Business Email",
  "What type of business is this workspace for?",
  "Team Size",
  "Number of Locations"
]) {
  assert.match(form, new RegExp(label.replace(/[?]/g, "\\?")), `workspace form must render ${label}`);
}
for (const suggestion of ["Retail", "Restaurant", "Construction", "Healthcare", "Logistics", "Manufacturing", "Professional Services", "Software", "Automotive", "Government", "Security", "Education"]) {
  assert.match(agreement, new RegExp(`"${suggestion}"`), `business type suggestions must include ${suggestion}`);
}
assert.match(form, /list="business-type-suggestions"/, "business type must provide autocomplete while remaining free text");
assert.match(form, /useState<Record<string, boolean>>\(\{\}\)/, "agreement checkboxes must start unchecked");
assert.doesNotMatch(form, /defaultChecked/, "no agreement checkbox may be pre-checked");
assert.match(form, /disabled=\{!ready\}/, "Create Workspace must remain disabled until the form is ready");
assert.match(form, /businessEmailIsValid/, "button readiness must include business-email validity");
assert.match(form, /allAgreementSectionsAccepted/, "button readiness must require every agreement section");
assert.match(form, /signatureMatches/, "button readiness must require a matching signature");
assert.match(form, /agreementGenerated/, "button readiness must require available agreement and policy versions");

const exactClauses = [
  "I confirm that I am authorized to create and administer this workspace and to upload, connect, manage, and process information for this organization.",
  "I authorize Vaeroex to securely receive, store, organize, retrieve, index, analyze, and process information submitted to this workspace in order to provide Executive Intelligence and related platform functionality.",
  "I understand that Vaeroex provides decision-support tools only. AI-generated summaries, explanations, classifications, predictions, recommendations, perspectives, and analyses may be incomplete or inaccurate and must always be reviewed using human judgment.",
  "I understand that Vaeroex does not guarantee business outcomes including profitability, compliance, growth, operational performance, cost savings, security, or any specific result. My organization remains responsible for all business decisions and actions.",
  "I have read and agree to the Terms of Service and Privacy Policy."
];
for (const clause of exactClauses) assert.ok(agreement.includes(clause), "the exact approved agreement text must be retained");
assert.match(agreement, /WORKSPACE_AGREEMENT_SECTIONS/, "agreement sections must be versioned in one canonical contract");
assert.match(agreement, /By typing my name and selecting Create Workspace, I intend to electronically sign this Workspace Agreement\./, "electronic-signature intent must be exact");
assert.match(schema, /signatureReasonablyMatches/, "server validation must reject a mismatched typed signature");
assert.match(schema, /z\.literal\(true/g, "all agreement and signature confirmations must be required server-side");
assert.match(schema, /\.strict\(\)/, "persisted snapshots must reject unknown contract fields");

for (const field of [
  "agreementId", "workspaceId", "organizationName", "legalName", "jobTitle", "businessEmail",
  "businessType", "agreementText", "agreementVersion", "termsVersion", "privacyVersion", "typedSignature",
  "signedAt", "authenticatedUserId", "applicationVersion", "recordClass", "eligibility"
]) {
  assert.match(record + agreement, new RegExp(field), `immutable agreement snapshot must include ${field}`);
}
assert.match(record, /createHash\("sha256"\)/, "the immutable agreement must receive a SHA-256 hash");
assert.match(record, /VERCEL_GIT_COMMIT_SHA/, "the agreement must preserve the application release version");

assert.match(pdf, /PDFDocument\.create\(\)/, "a PDF document must be generated");
assert.match(pdf, /document\.registerFontkit\(fontkit\)/, "the PDF must register its embedded Unicode font support");
assert.match(pdf, /NotoSans-Regular\.ttf/, "the PDF must embed its licensed customer-data font");
assert.equal(exists("public/fonts/NotoSans-Regular.ttf"), true, "the PDF regular font must be packaged with the application");
assert.equal(exists("public/fonts/NotoSans-Bold.ttf"), true, "the PDF bold font must be packaged with the application");
assert.match(nextConfig, /"\/app\/setup"[\s\S]+NotoSans-Regular\.ttf[\s\S]+NotoSans-Bold\.ttf/, "the setup server trace must include both PDF font files");
assert.match(read("public/fonts/OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/, "embedded fonts must retain their license");
assert.match(pdf, /Workspace Agreement/, "the PDF must identify the legal record");
assert.match(pdf, /Typed signature/, "the PDF must contain the typed signature");
assert.match(pdf, /Immutable SHA-256 hash/, "the PDF must contain its agreement hash");
assert.match(pdf, /return Buffer\.from\(await document\.save\(\)\)/, "PDF generation must return persisted bytes");

const pdfGeneration = setupAction.indexOf("generateWorkspaceAgreementPdf");
const pdfUpload = setupAction.indexOf(".upload(storagePath, pdf");
const transaction = setupAction.indexOf('admin.rpc("create_workspace_with_signed_agreement"');
const workspaceCookie = setupAction.indexOf('cookieStore.set("vaeroex_workspace_id"');
assert.ok(pdfGeneration >= 0 && pdfUpload > pdfGeneration && transaction > pdfUpload && workspaceCookie > transaction, "PDF generation and storage must succeed before transactional workspace activation");
assert.match(setupAction, /\.remove\(\[storagePath\]\)/, "a failed transaction must clean up its inaccessible staged PDF");
assert.match(setupAction, /No usable workspace was created/, "transaction failure must fail closed");
assert.doesNotMatch(setupAction, /VAEROEX_SYSTEM_PROMPT|openai|nvidia|generateWorkspaceFromSetupAction/, "workspace setup must not invoke a model or the retired questionnaire path");
for (const retiredWrite of ["business_intakes", "forms", "checklists", "workflow_maps", "sops", "issues", "assets", "reports", "ai_agent_runs"]) {
  assert.doesNotMatch(setupAction, new RegExp(`from\\("${retiredWrite}"\\)\\.insert`), `setup must not create synthetic ${retiredWrite} records`);
}

assert.match(migration, /create table if not exists public\.workspace_agreements/, "the migration must create the immutable agreement store");
assert.match(migration, /workspace_id uuid not null unique/, "each new workspace must have one creation agreement");
assert.match(migration, /record_class text not null default 'legal_agreement'/, "agreements must use a dedicated legal record class");
for (const flag of ["business_memory_eligible", "evidence_eligible", "embedding_eligible", "executive_intelligence_eligible", "retrieval_eligible"]) {
  assert.match(migration, new RegExp(`${flag} boolean not null default false check \\(${flag} = false\\)`), `${flag} must be structurally false`);
}
assert.match(migration, /alter table public\.workspace_agreements enable row level security/, "workspace agreement RLS must be enabled");
assert.match(migration, /using \(public\.is_workspace_member\(workspace_id\)\)/, "customer reads must remain workspace-scoped");
assert.match(migration, /revoke all on public\.workspace_agreements from anon, authenticated/, "direct table privileges must start denied");
assert.match(migration, /grant select on public\.workspace_agreements to authenticated/, "customers may only read agreement rows directly");
assert.doesNotMatch(migration, /grant (?:update|delete).*workspace_agreements to authenticated/i, "customers must never edit legal records");
assert.match(migration, /before update or delete on public\.workspace_agreements/, "agreement rows must be immutable");
assert.match(migration, /security invoker[\s\S]+create_workspace_with_signed_agreement|create_workspace_with_signed_agreement[\s\S]+security invoker/, "trusted workspace bootstrap must use a SECURITY INVOKER transaction");
assert.match(migration, /insert into public\.workspaces[\s\S]+insert into public\.workspace_members[\s\S]+insert into public\.workspace_agreements[\s\S]+insert into public\.audit_logs[\s\S]+insert into public\.security_audit_events/, "workspace, membership, agreement, and audits must share one database transaction");
assert.match(migration, /grant execute on function public\.create_workspace_with_signed_agreement[\s\S]+to service_role/, "only the trusted service role may execute workspace bootstrap");
assert.match(migration, /workspace agreement members read pdf[\s\S]+public\.is_workspace_member/, "private PDFs must enforce workspace membership");

assert.match(sources, /key: "legal", label: "Legal & Agreements"/, "Evidence must expose the dedicated legal-record tab");
assert.match(sources, /activeTab === "legal"[\s\S]+from\("workspace_agreements"\)/, "agreement rows must only be queried for the legal tab");
assert.match(agreementList, /not business evidence and never participate in Vaeroex intelligence or retrieval/, "the customer UI must distinguish legal records from evidence");
assert.match(customerPage, /\.eq\("workspace_id", workspaceId\)/, "customer agreement retrieval must be workspace-scoped");
assert.match(customerPage, /hashWorkspaceAgreement\(parsed\.data\) !== agreement\.immutable_hash/, "customer rendering must verify immutable snapshot integrity");
assert.match(customerPdf, /Authentication required/, "customer PDF retrieval must require authentication");
assert.match(customerPdf, /createHash\("sha256"\)/, "customer PDF downloads must verify persisted bytes");
assert.match(customerPdf, /Cache-Control": "private, no-store/, "legal PDF responses must not enter shared caches");

assert.match(adminPage, /Agreement, workspace, organization, or owner email/, "admin search must cover required agreement identifiers");
assert.match(adminPage, /type="date"/, "admin search must support signed date");
assert.match(adminPage, />View agreement<\/Link>/, "every agreement list row must expose a clear detail action");
assert.doesNotMatch(appShell + adminNav, /href: "\/app\/admin\/workspace-agreements"/, "Workspace Agreements must be managed from customer records instead of primary Admin navigation");
assert.match(adminWorkspaces, /AdminWorkspaceQueueTable/, "the workspace exception queue must retain agreement status");
assert.match(adminCustomers, /AdminCompanyTable/, "the customer directory must use the shared company rows with agreement status");
assert.match(adminCompanyDetail, /from\("workspace_agreements"\)\.select\("\*"\)/, "company detail must load the retained agreement record");
assert.match(adminCompanyTable + adminWorkspaceTable + adminCompanyDetail, /\/app\/admin\/workspace-agreements\/\$\{(?:(?:company|workspace)\.agreement_id|agreement\.id)\}/, "Admin company surfaces must link to the existing secure detail page");
assert.match(adminCompanyTable + adminWorkspaceTable + adminCompanyDetail, /View agreement/, "Admin company surfaces must expose a visible agreement action");
assert.match(adminCompanyTable + adminWorkspaceTable + adminCompanyDetail, /No agreement/, "Admin company surfaces must explicitly identify workspaces without an agreement");
assert.match(adminDetail, /hashWorkspaceAgreement\(parsed\.data\) !== agreement\.immutable_hash/, "admin rendering must verify immutable snapshot integrity");
assert.match(adminPdf, /getVaeroexAdminAccess/, "admin PDF retrieval must require Vaeroex admin authorization");
assert.match(adminPdf, /createHash\("sha256"\)/, "admin PDF downloads must verify persisted bytes");

assert.match(email, /Idempotency-Key.*workspace-agreement-/, "confirmation email delivery must be idempotent per agreement");
assert.match(email, /Agreement ID/, "confirmation email must include the agreement ID");
assert.match(email, /secure link requires sign-in/i, "confirmation email must describe the secure customer link");
assert.doesNotMatch(email, /immutable_hash|security_audit_events|audit_logs|authenticated_user_id/, "confirmation email must not expose internal audit metadata");

assert.match(setupAction, /deliverWorkspaceAgreementAdminEmail/, "workspace finalization must invoke the separate administrative email workflow");
const adminEmailDelivery = setupAction.indexOf("deliverWorkspaceAgreementAdminEmail({");
assert.ok(adminEmailDelivery > transaction, "administrative email delivery must run only after the agreement transaction succeeds");
assert.doesNotMatch(setupAction.slice(adminEmailDelivery), /setupError\(/, "administrative email failure must not invalidate the signed agreement or workspace");
for (const field of ["Organization", "Workspace owner", "Workspace owner email", "Agreement ID", "Signed at"]) {
  assert.match(adminEmail, new RegExp(field), `administrative email must include ${field}`);
}
assert.match(adminEmail, /admin@vaeroex\.com/, "administrative agreement email must use the fixed legal recipient");
assert.match(setupAction + adminActions, /\/app\/admin\/workspace-agreements\//, "administrative email must link to the secure canonical admin record");
assert.match(adminEmail, /VERCEL_ENV === "production"/, "automatic administrative email must be Production-only");
assert.match(adminEmail, /AbortSignal\.timeout\(15_000\)/, "the provider attempt must have a bounded deadline");
assert.doesNotMatch(adminEmail, /for\s*\(|while\s*\(|setInterval|setTimeout/, "administrative email delivery must not create an automatic retry loop");
assert.doesNotMatch(adminEmail, /attachments?\s*:/i, "administrative email must use the secure link rather than attach the PDF");

assert.match(adminEmailMigration, /create table if not exists public\.workspace_agreement_admin_email_deliveries/, "administrative delivery status must use a separate table");
for (const status of ["pending", "sent", "failed", "skipped"]) {
  assert.match(adminEmailMigration, new RegExp(`'${status}'`), `delivery status must support ${status}`);
}
for (const field of ["provider_message_id", "failure_reason", "attempt_count", "release_channel", "last_attempt_source"]) {
  assert.match(adminEmailMigration, new RegExp(field), `delivery status must retain ${field}`);
}
assert.match(adminEmailMigration, /enable row level security/, "administrative delivery status must enable RLS");
assert.match(adminEmailMigration, /revoke all[\s\S]+from public, anon, authenticated/, "administrative delivery status must be server-only");
assert.match(adminEmailMigration, /grant select, insert, update[\s\S]+to service_role/, "trusted server operations must receive only required delivery privileges");
assert.doesNotMatch(adminEmailMigration, /grant delete|grant truncate/i, "administrative delivery status must not grant destructive privileges");

assert.match(adminActions, /requireVaeroexAdmin/, "manual administrative resend must require Vaeroex admin authorization");
assert.match(adminActions, /source: "admin_resend"/, "manual resend must be explicitly attributed");
assert.match(adminDetail, /delivery\.status === "failed" \|\| delivery\.status === "skipped"/, "manual resend must only appear for failed or skipped delivery");
assert.match(adminDetail, /Send administrative email/, "authorized administrators must have a manual resend action");

const administrativeDeliverySources = [setupAction, adminEmail, adminActions, adminDetail, adminEmailMigration].join("\n");
assert.doesNotMatch(administrativeDeliverySources, /from\(["']notifications["']\)|notification-center|unread badge|notification preferences/i, "Workspace Agreement email must not reuse the retired notification architecture");
assert.match(read("components/legal/WorkspaceAgreementActions.tsx"), /View PDF[\s\S]+Download[\s\S]+Print/, "customer View, Download, and Print actions must remain available");

const sourceFiles = ["app", "components", "lib"].flatMap((directory) => {
  const walk = (current) => fs.readdirSync(path.join(root, current), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) return walk(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
  return walk(directory);
});
const agreementReferences = sourceFiles.filter((file) => read(file).includes("workspace_agreements"));
const allowedReferenceRoots = [
  "app/app/setup/actions.ts",
  "app/app/sources/page.tsx",
  "app/app/legal/agreements/",
  "app/app/admin/workspace-agreements/",
  "app/app/admin/workspaces/page.tsx",
  "app/app/admin/customers/page.tsx",
  "app/app/admin/customers/[workspaceId]/page.tsx",
  "app/api/legal/workspace-agreements/",
  "app/api/admin/workspace-agreements/",
  "components/legal/WorkspaceAgreementList.tsx",
  "lib/supabase/types.ts"
];
const unexpectedReferences = agreementReferences.filter((file) => !allowedReferenceRoots.some((allowed) => file === allowed || file.startsWith(allowed)));
assert.deepEqual(unexpectedReferences, [], `legal agreements must not enter business search, memory, evidence, embeddings, health, findings, or executive intelligence: ${unexpectedReferences.join(", ")}`);

process.stdout.write("Workspace Agreement regressions passed.\n");
