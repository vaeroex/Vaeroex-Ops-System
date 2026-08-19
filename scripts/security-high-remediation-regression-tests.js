const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const migrationPath = "supabase/migrations/20260819174100_security_high_findings_remediation.sql";
const migration = read(migrationPath);
const rateLimit = read("lib/security/rate-limit.ts");
const supportAction = read("app/support/actions.ts");
const activationRoute = read("app/api/subscription/request-activation/route.ts");
const publicFormRoute = read("app/api/public/forms/[slug]/submit/route.ts");
const packageJson = JSON.parse(read("package.json"));
const lockfile = read("pnpm-lock.yaml");

const {
  ACTIVATION_FORM_MAX_BODY_BYTES,
  boundedFormData,
  MANUAL_ACTIVATION_REQUEST_KEYS,
  manualActivationRequestSchema,
  PUBLIC_FORM_MAX_BODY_BYTES,
  publicFormSubmissionSchema,
  readBoundedJson,
  readBoundedUrlEncodedFormData,
  SUPPORT_FORM_MAX_BODY_BYTES,
  SUPPORT_REQUEST_KEYS,
  supportRequestSchema,
  validatePublicFormFields
} = require(path.join(root, "lib/security/public-submission-validation.ts"));

assert.match(migration, /create or replace function public\.can_contribute_workspace/);
assert.match(migration, /membership\.role in \('owner', 'admin', 'manager', 'staff'\)/);
assert.doesNotMatch(migration, /membership\.role in \([^)]*'viewer'/);

assert.match(migration, /drop policy if exists "authenticated users can create workspaces"/);
assert.match(migration, /revoke insert on table public\.workspaces from authenticated/);
assert.match(migration, /revoke update on table public\.workspaces from authenticated/);
assert.match(migration, /grant update \(\s*name,\s*industry,\s*size,\s*logo_url,\s*primary_contact_name,\s*primary_contact_email/);
for (const protectedColumn of ["subscription_required", "manually_unlocked", "subscription_status", "plan_slug", "trial_ends_at", "created_by"]) {
  assert.doesNotMatch(
    migration.match(/grant update \([\s\S]*?\) on table public\.workspaces to authenticated/)?.[0] || "",
    new RegExp(`\\b${protectedColumn}\\b`),
    `${protectedColumn} must not be included in authenticated workspace update grants`
  );
}
assert.match(migration, /revoke insert, update, delete on table public\.customer_subscriptions from authenticated/);

assert.match(migration, /create policy "admins can invite non-owner members"[\s\S]*role <> 'owner'/);
assert.match(migration, /create policy "admins can update non-owner members"[\s\S]*using \([\s\S]*role <> 'owner'[\s\S]*with check \([\s\S]*role <> 'owner'/);
assert.match(migration, /create policy "admins can delete non-owner members"[\s\S]*role <> 'owner'/);
assert.match(migration, /public\.can_contribute_workspace\(workspace_id\)/);
assert.match(migration, /public\.can_contribute_workspace\(split_part\(name, '\/', 1\)::uuid\)/);

const contributorPolicyBlock = migration.match(
  /do \$workspace_contributor_policies\$[\s\S]*?\$workspace_contributor_policies\$;/
)?.[0];
assert.ok(contributorPolicyBlock, "the contributor policy replacement block must exist");
for (const table of ["form_submissions", "asset_checks", "file_uploads", "file_imports", "file_import_rows", "crm_leads", "operational_metrics"]) {
  assert.match(contributorPolicyBlock, new RegExp(`'${table}'`));
}
for (const managerOnlyTable of ["forms", "checklists", "issues", "assets"]) {
  assert.doesNotMatch(
    contributorPolicyBlock,
    new RegExp(`'${managerOnlyTable}'`),
    `${managerOnlyTable} must retain its existing manager-only write boundary`
  );
}

for (const policy of [
  "anyone can create support requests",
  "users can create activation requests",
  "public can submit public forms"
]) {
  assert.match(migration, new RegExp(`drop policy if exists "${policy}"`));
}
assert.match(migration, /revoke insert, update, delete on table public\.support_requests from anon, authenticated/);
assert.match(migration, /revoke insert, update, delete on table public\.manual_activation_requests from anon, authenticated/);
assert.match(migration, /revoke insert, update, delete on table public\.form_submissions from anon/);

assert.match(migration, /create or replace function public\.consume_request_rate_limit_v1/);
assert.match(migration, /security invoker/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /on conflict on constraint request_rate_limits_unique_window/);
assert.match(migration, /where rate_limit\.count < p_limit/);
assert.match(migration, /grant execute on function public\.consume_request_rate_limit_v1[\s\S]*to service_role/);
assert.doesNotMatch(rateLimit, /\.from\("request_rate_limits"\)/, "the application must not use a race-prone read-then-write limiter");
assert.match(rateLimit, /\.rpc\("consume_request_rate_limit_v1"/);

for (const handler of [supportAction, activationRoute, publicFormRoute]) {
  assert.match(handler, /strict: true/, "every public ingress must fail closed when quota verification is unavailable");
}
assert.match(supportAction, /supportRequestSchema\.parse/);
assert.match(supportAction, /const admin = createSupabaseAdminClient\(\)/);
assert.doesNotMatch(supportAction, /const client = admin \|\| supabase/);
assert.match(supportAction, /\["\/support", "\/app\/support", "\/contact", "\/demo"\]\.includes\(returnPath\)/);
assert.match(activationRoute, /manualActivationRequestSchema\.parse/);
assert.match(activationRoute, /status: "pending"/);
assert.match(publicFormRoute, /\.eq\("public_slug", slug\)/);
assert.match(publicFormRoute, /\.eq\("is_public", true\)/);
assert.match(publicFormRoute, /workspace_id: form\.workspace_id/);
assert.match(publicFormRoute, /form_id: form\.id/);
assert.doesNotMatch(publicFormRoute, /workspace_id: submission/);
assert.doesNotMatch(publicFormRoute, /form_id: submission/);
assert.ok(
  publicFormRoute.indexOf('action: "public_form.submit"') < publicFormRoute.indexOf("if (submission.website)"),
  "the honeypot path must still consume the public-form quota"
);

const validSupport = {
  return_path: "/support",
  name: "Security Test",
  email: "SECURITY@example.test",
  issue_type: "Other",
  message: "Please review this request.",
  priority: "Medium"
};
assert.equal(supportRequestSchema.parse(validSupport).email, "security@example.test");
assert.equal(supportRequestSchema.parse({ ...validSupport, issue_type: "Vaeroex result" }).issue_type, "Vaeroex result");
assert.throws(() => supportRequestSchema.parse({ ...validSupport, status: "resolved" }));
assert.throws(() => supportRequestSchema.parse({ ...validSupport, priority: "Critical" }));
assert.throws(() => supportRequestSchema.parse({ ...validSupport, message: "x".repeat(6001) }));

const supportForm = new FormData();
for (const [key, value] of Object.entries(validSupport)) supportForm.set(key, value);
assert.equal(
  supportRequestSchema.parse(boundedFormData(supportForm, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES)).issue_type,
  "Other"
);
supportForm.set("status", "resolved");
assert.throws(() => boundedFormData(supportForm, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES));
const oversizedActionMetadata = new FormData();
oversizedActionMetadata.set("$ACTION_ID_attack", "x".repeat(SUPPORT_FORM_MAX_BODY_BYTES));
assert.throws(() => boundedFormData(oversizedActionMetadata, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES));
const actionMetadataFlood = new FormData();
for (let index = 0; index < SUPPORT_REQUEST_KEYS.length + 9; index += 1) {
  actionMetadataFlood.append(`$ACTION_ID_${index}`, "x");
}
assert.throws(() => boundedFormData(actionMetadataFlood, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES));

const validActivation = {
  name: "Customer",
  email: "customer@example.test",
  company: "Example",
  plan_purchased: "Vaeroex",
  order_number: "ORDER-1",
  message: "Please verify."
};
assert.equal(manualActivationRequestSchema.parse(validActivation).email, validActivation.email);
assert.throws(() => manualActivationRequestSchema.parse({ ...validActivation, status: "approved" }));
const activationForm = new FormData();
for (const [key, value] of Object.entries(validActivation)) activationForm.set(key, value);
activationForm.set("message", "x".repeat(ACTIVATION_FORM_MAX_BODY_BYTES));
assert.throws(() => boundedFormData(activationForm, MANUAL_ACTIVATION_REQUEST_KEYS, ACTIVATION_FORM_MAX_BODY_BYTES));

const formSchema = [
  { key: "summary", required: true },
  { key: "priority", required: false }
];
const parsedPublic = publicFormSubmissionSchema.parse({
  submitter_name: "Customer",
  submitter_email: "customer@example.test",
  fields: { summary: "A valid response", priority: "High" }
});
assert.deepEqual(validatePublicFormFields(parsedPublic.fields, formSchema), parsedPublic.fields);
assert.throws(() => validatePublicFormFields({ summary: "Valid", workspace_id: "forged" }, formSchema));
assert.throws(() => validatePublicFormFields({ priority: "High" }, formSchema));
assert.throws(() => publicFormSubmissionSchema.parse({ fields: {}, status: "approved" }));

assert.equal(packageJson.dependencies.next, "15.5.21");
assert.equal(packageJson.devDependencies["eslint-config-next"], "15.5.21");
assert.match(lockfile, /next@15\.5\.21/);
assert.match(lockfile, /eslint-config-next@15\.5\.21/);
assert.doesNotMatch(lockfile, /next@15\.5\.19/);

async function verifyBoundedReaders() {
  const jsonRequest = new Request("https://example.test/api/public/forms/example/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: { summary: "Bounded" } })
  });
  assert.deepEqual(await readBoundedJson(jsonRequest, PUBLIC_FORM_MAX_BODY_BYTES), { fields: { summary: "Bounded" } });

  const formRequest = new Request("https://example.test/api/subscription/request-activation", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(validActivation)
  });
  const boundedActivation = await readBoundedUrlEncodedFormData(formRequest, ACTIVATION_FORM_MAX_BODY_BYTES);
  assert.equal(boundedActivation.get("email"), validActivation.email);

  const oversizedRequest = new Request("https://example.test/api/public/forms/example/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: { summary: "x".repeat(128) } })
  });
  await assert.rejects(() => readBoundedJson(oversizedRequest, 32), /too large/i);
}

verifyBoundedReaders()
  .then(() => console.log("Security HIGH remediation regressions passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
