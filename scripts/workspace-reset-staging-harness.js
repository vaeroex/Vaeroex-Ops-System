/* eslint-disable no-console */
// STAGING ONLY. This script creates disposable users, workspaces, records, and
// Storage objects, then removes them in finally. It refuses to run unless the
// staging and production project references are both supplied and different.

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const CONFIRMATION = "RUN_WORKSPACE_RESET_STAGING";
const url = process.env.VAEROEX_STAGING_SUPABASE_URL || "";
const serviceRoleKey = process.env.VAEROEX_STAGING_SERVICE_ROLE_KEY || "";
const stagingRef = process.env.VAEROEX_STAGING_PROJECT_REF || "";
const productionRef = process.env.VAEROEX_PRODUCTION_PROJECT_REF || "";
const publicKey = process.env.VAEROEX_STAGING_PUBLISHABLE_KEY || process.env.VAEROEX_STAGING_ANON_KEY || "";
const knownProductionUrls = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]
  .filter(Boolean)
  .map((value) => String(value).replace(/\/$/, ""));
const knownProductionServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const RESETTABLE_TABLES = [
  "record_folders",
  "file_uploads",
  "file_imports",
  "file_import_rows",
  "file_processing_jobs",
  "business_memory_chunks",
  "business_health_snapshots",
  "crm_leads",
  "crm_lead_history",
  "operational_metrics",
  "business_intakes",
  "workflow_maps",
  "forms",
  "form_submissions",
  "checklists",
  "checklist_runs",
  "tasks",
  "kpis",
  "kpi_settings",
  "issues",
  "assets",
  "asset_checks",
  "people",
  "sops",
  "reports",
  "ai_agent_runs",
  "notifications",
  "record_shares",
  "operational_assignments",
  "business_decisions",
  "vaeroex_recommendation_outcomes",
  "kpi_alert_rules",
  "kpi_alert_events",
  "report_subscription_preferences",
  "scheduled_report_runs"
];

function projectRefFromUrl(value) {
  try {
    return new URL(value).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

if (process.env.VAEROEX_STAGING_CONFIRM !== CONFIRMATION) {
  throw new Error(`Refusing to run. Set VAEROEX_STAGING_CONFIRM=${CONFIRMATION} only for a disposable staging test.`);
}
if (!url || !serviceRoleKey || !publicKey || !stagingRef || !productionRef) {
  throw new Error("Staging URL, service role, publishable key, staging project ref, and production project ref are required.");
}
const connectedRef = projectRefFromUrl(url);
if (!connectedRef || connectedRef !== stagingRef || connectedRef === productionRef || stagingRef === productionRef) {
  throw new Error("Refusing to run because the connected Supabase project was not proven to be non-production staging.");
}
if (knownProductionUrls.includes(url.replace(/\/$/, "")) || (knownProductionServiceRoleKey && serviceRoleKey === knownProductionServiceRoleKey)) {
  throw new Error("Refusing to run because staging credentials match production credentials already present in this shell.");
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const passwordA = `Staging-A-${randomUUID()}!`;
const passwordB = `Staging-B-${randomUUID()}!`;
const emailA = `workspace-reset-a-${suffix}@example.invalid`;
const emailB = `workspace-reset-b-${suffix}@example.invalid`;
const cleanup = {
  userIds: [],
  workspaceIds: [],
  storagePaths: [],
  operationIds: [],
  preservedIds: {
    ai_usage: [],
    audit_logs: [],
    customer_subscriptions: [],
    security_audit_events: [],
    support_requests: []
  }
};

async function must(result, label) {
  const resolved = await result;
  if (resolved.error) throw new Error(`${label}: ${resolved.error.message}`);
  return resolved.data;
}

async function createTemporaryUser(email, password) {
  const data = await must(admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${email}`);
  cleanup.userIds.push(data.user.id);
  return data.user;
}

async function signIn(email, password) {
  const client = createClient(url, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  await must(client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return client;
}

async function createWorkspace(owner, name) {
  await must(admin.from("profiles").upsert({ id: owner.id, email: owner.email, full_name: name }), "upsert profile");
  const workspace = await must(
    admin.from("workspaces").insert({ name, created_by: owner.id, subscription_required: false, manually_unlocked: true }).select("id,name").single(),
    "create workspace"
  );
  cleanup.workspaceIds.push(workspace.id);
  await must(admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: owner.id, role: "owner", status: "active" }), "create owner membership");
  return workspace;
}

async function insertOne(table, values, label) {
  return must(admin.from(table).insert(values).select("id").single(), label);
}

async function workspaceCounts(workspaceId) {
  const counts = {};
  for (const table of RESETTABLE_TABLES) {
    let query = admin.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    if (table === "record_folders") query = query.neq("collection_type", "support_requests");
    const { count, error } = await query;
    if (error) throw new Error(`count ${table}: ${error.message}`);
    counts[table] = count || 0;
  }
  return counts;
}

function assertWorkspaceCounts(counts, expected, label) {
  for (const table of RESETTABLE_TABLES) {
    assert.equal(counts[table], expected, `${label}: ${table} should contain ${expected} fixture row(s)`);
  }
}

async function seedPreservedData(workspace, owner) {
  const rows = {
    audit_logs: await insertOne(
      "audit_logs",
      {
        workspace_id: workspace.id,
        actor_user_id: owner.id,
        action: "workspace_reset_staging_preserved",
        entity_type: "staging_fixture",
        metadata_json: { disposable: true }
      },
      "create preserved audit row"
    ),
    security_audit_events: await insertOne(
      "security_audit_events",
      {
        workspace_id: workspace.id,
        user_id: owner.id,
        action_name: "staging.workspace_reset.preserved",
        operation_type: "SYSTEM",
        initiated_by: "system",
        allowed: true,
        metadata_json: { disposable: true }
      },
      "create preserved security audit row"
    ),
    ai_usage: await insertOne(
      "ai_usage",
      {
        workspace_id: workspace.id,
        user_id: owner.id,
        agent_type: "workspace_reset_staging",
        tokens_used: 1,
        estimated_cost_cents: 0,
        status: "completed",
        metadata_json: { disposable: true }
      },
      "create preserved AI accounting row"
    ),
    customer_subscriptions: await insertOne(
      "customer_subscriptions",
      {
        workspace_id: workspace.id,
        user_id: owner.id,
        customer_email: owner.email,
        source: "staging_fixture",
        billing_provider: "manual",
        status: "active",
        raw_payload_json: { disposable: true }
      },
      "create preserved subscription row"
    ),
    support_requests: await insertOne(
      "support_requests",
      {
        workspace_id: workspace.id,
        user_id: owner.id,
        name: "Workspace reset staging",
        email: owner.email,
        issue_type: "staging_fixture",
        message: "Disposable support record that must survive business-data reset."
      },
      "create preserved support row"
    )
  };

  for (const [table, row] of Object.entries(rows)) cleanup.preservedIds[table].push(row.id);
  return Object.fromEntries(Object.entries(rows).map(([table, row]) => [table, row.id]));
}

async function assertPreservedData(ids, label) {
  for (const [table, id] of Object.entries(ids)) {
    const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("id", id);
    if (error) throw new Error(`verify preserved ${table}: ${error.message}`);
    assert.equal(count, 1, `${label}: preserved ${table} row must remain`);
  }
}

async function seedAllResettableData(workspace, owner) {
  const ownerId = owner.id;
  const folder = await insertOne(
    "record_folders",
    { workspace_id: workspace.id, collection_type: "files", name: "Reset staging evidence", created_by: ownerId },
    "create folder"
  );
  const storagePath = `${workspace.id}/${randomUUID()}/reset-staging.csv`;
  cleanup.storagePaths.push(storagePath);
  await must(
    admin.storage.from("workspace-files").upload(storagePath, Buffer.from("metric,value\nreset_staging,10\n"), { contentType: "text/csv", upsert: false }),
    "upload fixture"
  );
  const file = await insertOne(
    "file_uploads",
    {
      workspace_id: workspace.id,
      folder_id: folder.id,
      original_name: "reset-staging.csv",
      display_name: "Reset staging evidence",
      file_extension: "csv",
      mime_type: "text/csv",
      file_size_bytes: 30,
      storage_path: storagePath,
      created_by: ownerId
    },
    "create file row"
  );
  const fileImport = await insertOne(
    "file_imports",
    { workspace_id: workspace.id, file_upload_id: file.id, import_type: "kpi", created_by: ownerId },
    "create file import"
  );
  const importRow = await insertOne(
    "file_import_rows",
    {
      workspace_id: workspace.id,
      file_upload_id: file.id,
      import_id: fileImport.id,
      import_type: "kpi",
      row_number: 1,
      data_json: { metric: "Reset staging KPI", value: 10 }
    },
    "create file import row"
  );
  const person = await insertOne(
    "people",
    { workspace_id: workspace.id, full_name: "Disposable staging person", created_by: ownerId },
    "create person"
  );
  const form = await insertOne("forms", { workspace_id: workspace.id, name: "Reset staging form", created_by: ownerId }, "create form");
  const checklist = await insertOne(
    "checklists",
    { workspace_id: workspace.id, name: "Reset staging checklist", created_by: ownerId },
    "create checklist"
  );
  const asset = await insertOne("assets", { workspace_id: workspace.id, asset_name: "Reset staging asset" }, "create asset");
  const report = await insertOne(
    "reports",
    {
      workspace_id: workspace.id,
      report_type: "Executive Brief",
      title: "Reset staging report",
      body_markdown: "Disposable derived analysis.",
      source_data_json: { evidence_role: "derived_analysis" },
      created_by: ownerId
    },
    "create report"
  );
  const sop = await insertOne("sops", { workspace_id: workspace.id, title: "Reset staging SOP", created_by: ownerId }, "create SOP");
  const issue = await insertOne("issues", { workspace_id: workspace.id, title: "Reset staging issue", created_by: ownerId }, "create issue");
  const signal = await insertOne(
    "tasks",
    { workspace_id: workspace.id, title: "Reset staging Business Signal", category: "Operations", created_by: ownerId },
    "create Business Signal"
  );
  const kpiSettings = await insertOne(
    "kpi_settings",
    { workspace_id: workspace.id, kpi_name: "Reset staging KPI", target: 12, created_by: ownerId },
    "create KPI settings"
  );
  const alertRule = await insertOne(
    "kpi_alert_rules",
    { workspace_id: workspace.id, kpi_name: "Reset staging KPI", condition_type: "below_target", created_by: ownerId },
    "create KPI alert rule"
  );
  await insertOne(
    "business_intakes",
    {
      workspace_id: workspace.id,
      company_name: workspace.name,
      raw_answers_json: { evidence_classification: "business_evidence", disposable: true },
      created_by: ownerId
    },
    "create business intake"
  );
  await insertOne(
    "workflow_maps",
    { workspace_id: workspace.id, name: "Reset staging workflow", created_by: ownerId },
    "create workflow map"
  );
  const run = await insertOne(
    "ai_agent_runs",
    { workspace_id: workspace.id, agent_type: "workspace_reset_staging", status: "completed", created_by: ownerId },
    "create AI run"
  );
  await insertOne(
    "notifications",
    { workspace_id: workspace.id, user_id: ownerId, type: "staging_fixture", title: "Reset staging notification" },
    "create notification"
  );
  await insertOne(
    "operational_metrics",
    {
      workspace_id: workspace.id,
      source_file_id: file.id,
      import_id: fileImport.id,
      import_row_id: importRow.id,
      metric_name: "Reset staging metric",
      value: 10,
      metric_date: new Date().toISOString().slice(0, 10),
      created_by: ownerId
    },
    "create operational metric"
  );
  const lead = await insertOne(
    "crm_leads",
    {
      workspace_id: workspace.id,
      source_file_id: file.id,
      import_id: fileImport.id,
      import_row_id: importRow.id,
      lead_name: "Historical staging customer evidence",
      created_by: ownerId
    },
    "create historical customer evidence"
  );
  const kpi = await insertOne(
    "kpis",
    {
      workspace_id: workspace.id,
      name: "Reset staging KPI",
      actual_value: 10,
      target: 12,
      source_file_id: file.id,
      import_id: fileImport.id,
      import_row_id: importRow.id,
      created_by: ownerId
    },
    "create KPI"
  );
  await insertOne(
    "file_processing_jobs",
    { workspace_id: workspace.id, file_upload_id: file.id, job_type: "index", created_by: ownerId },
    "create file processing job"
  );
  await insertOne(
    "business_memory_chunks",
    {
      workspace_id: workspace.id,
      source_type: "file",
      source_id: file.id,
      source_file_id: file.id,
      source_title: "Reset staging evidence",
      source_excerpt: "Disposable evidence",
      content_hash: randomUUID(),
      source_metadata: { evidence_classification: "business_evidence" }
    },
    "create memory chunk"
  );
  await insertOne(
    "business_health_snapshots",
    { workspace_id: workspace.id, score: 50, status: "Watch", trend: "Stable", data_confidence: "Low" },
    "create health snapshot"
  );
  await insertOne(
    "form_submissions",
    { workspace_id: workspace.id, form_id: form.id, submitted_by: ownerId, data_json: { disposable: true } },
    "create form submission"
  );
  await insertOne(
    "checklist_runs",
    { workspace_id: workspace.id, checklist_id: checklist.id, assigned_to: ownerId, responses_json: { disposable: true } },
    "create checklist run"
  );
  await insertOne(
    "asset_checks",
    { workspace_id: workspace.id, asset_id: asset.id, checked_by: ownerId, status: "Good" },
    "create asset check"
  );
  await insertOne(
    "crm_lead_history",
    {
      workspace_id: workspace.id,
      lead_id: lead.id,
      source_file_id: file.id,
      import_id: fileImport.id,
      import_row_id: importRow.id,
      event_type: "snapshot",
      created_by: ownerId
    },
    "create historical customer event"
  );
  await insertOne(
    "record_shares",
    {
      workspace_id: workspace.id,
      source_type: "report",
      source_id: report.id,
      source_title: report.title || "Reset staging report",
      created_by: ownerId
    },
    "create record share"
  );
  await insertOne(
    "operational_assignments",
    {
      workspace_id: workspace.id,
      source_type: "report",
      source_id: report.id,
      source_title: "Reset staging report",
      title: "Legacy staging assignment",
      assigned_person_id: person.id,
      created_by: ownerId
    },
    "create operational assignment"
  );
  await insertOne(
    "business_decisions",
    {
      workspace_id: workspace.id,
      title: "Reset staging decision",
      related_report_id: report.id,
      related_issue_id: issue.id,
      related_sop_id: sop.id,
      created_by: ownerId
    },
    "create business decision"
  );
  await insertOne(
    "vaeroex_recommendation_outcomes",
    {
      workspace_id: workspace.id,
      title: "Reset staging recommendation outcome",
      source_type: "run",
      source_id: run.id,
      related_report_id: report.id,
      related_file_id: file.id,
      related_issue_id: issue.id,
      related_task_id: signal.id,
      created_by: ownerId
    },
    "create recommendation outcome"
  );
  await insertOne(
    "kpi_alert_events",
    {
      workspace_id: workspace.id,
      rule_id: alertRule.id,
      kpi_id: kpi.id,
      title: "Reset staging KPI alert",
      message: "Disposable KPI alert.",
      created_by: ownerId
    },
    "create KPI alert event"
  );
  await insertOne(
    "report_subscription_preferences",
    { workspace_id: workspace.id, category: "weekly_review", created_by: ownerId },
    "create report preference"
  );
  await insertOne(
    "scheduled_report_runs",
    {
      workspace_id: workspace.id,
      category: "weekly_review",
      report_id: report.id,
      run_date: new Date().toISOString().slice(0, 10)
    },
    "create scheduled report run"
  );

  const counts = await workspaceCounts(workspace.id);
  assertWorkspaceCounts(counts, 1, `${workspace.name} fixture seed`);
  const preservedIds = await seedPreservedData(workspace, owner);
  return { folderId: folder.id, fileId: file.id, signalId: signal.id, storagePath, preservedIds };
}

async function prepareManifest(
  userClient,
  workspace,
  storageMode,
  setupMode,
  operationId,
  storagePath,
  permanentPhrase = null,
  beginOperation = true
) {
  cleanup.operationIds.push(operationId);
  if (beginOperation) {
    await must(
      userClient.rpc("begin_workspace_data_reset", {
        p_workspace_id: workspace.id,
        p_confirmation_name: workspace.name,
        p_storage_mode: storageMode,
        p_setup_mode: setupMode,
        p_operation_id: operationId,
        p_permanent_phrase: permanentPhrase
      }),
      "begin reset"
    );
  }
  await must(
    admin.from("workspace_reset_storage_objects").insert({
      operation_id: operationId,
      workspace_id: workspace.id,
      bucket_id: "workspace-files",
      object_path: storagePath,
      retention_deadline: new Date(Date.now() + (storageMode === "recoverable" ? 30 * 86400000 : 0)).toISOString(),
      purge_status: "pending"
    }),
    "create manifest"
  );
  await must(
    admin.from("workspace_reset_operations").update({ manifest_completed_at: new Date().toISOString(), storage_summary: { object_count: 1 } }).eq("id", operationId).eq("workspace_id", workspace.id),
    "complete manifest"
  );
}

async function run() {
  let workspaceA;
  let workspaceB;
  try {
    const userA = await createTemporaryUser(emailA, passwordA);
    const userB = await createTemporaryUser(emailB, passwordB);
    workspaceA = await createWorkspace(userA, `Reset staging A ${suffix}`);
    workspaceB = await createWorkspace(userB, `Reset staging B ${suffix}`);
    const fixtureA = await seedAllResettableData(workspaceA, userA);
    const fixtureB = await seedAllResettableData(workspaceB, userB);
    const clientA = await signIn(emailA, passwordA);
    const clientB = await signIn(emailB, passwordB);

    await must(
      admin.from("workspace_members").insert({ workspace_id: workspaceA.id, user_id: userB.id, role: "member", status: "active" }),
      "create regular-member authorization fixture"
    );

    const anonymous = createClient(url, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const anonymousAttempt = await anonymous.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(anonymousAttempt.error, "anonymous callers must be denied");

    const denied = await clientB.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(denied.error, "a regular workspace member must be denied");

    const memberSourceDelete = await clientB.rpc("update_source_file_lifecycle", {
      p_workspace_id: workspaceA.id,
      p_file_id: fixtureA.fileId,
      p_action: "delete"
    });
    assert(memberSourceDelete.error, "regular members must not call the source lifecycle RPC directly");

    const crossWorkspaceAttempt = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceB.id,
      p_confirmation_name: workspaceB.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(crossWorkspaceAttempt.error, "an owner must not reset a workspace where they are not a member");

    const wrongName = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: "Wrong workspace name",
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(wrongName.error, "wrong workspace-name confirmation must be denied");

    const invalidMode = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "unsupported",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(invalidMode.error, "invalid storage mode must be denied");

    const invalidSetupMode = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "unsupported",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(invalidSetupMode.error, "invalid setup mode must be denied");

    const missingPermanentPhrase = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "permanent",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(missingPermanentPhrase.error, "permanent reset must require the exact irreversible phrase");

    await must(
      admin
        .from("workspace_members")
        .update({ role: "admin" })
        .eq("workspace_id", workspaceA.id)
        .eq("user_id", userB.id),
      "promote temporary admin fixture"
    );
    const adminProbeId = randomUUID();
    cleanup.operationIds.push(adminProbeId);
    await must(
      clientB.rpc("begin_workspace_data_reset", {
        p_workspace_id: workspaceA.id,
        p_confirmation_name: workspaceA.name,
        p_storage_mode: "recoverable",
        p_setup_mode: "blank",
        p_operation_id: adminProbeId,
        p_permanent_phrase: null
      }),
      "admin begin reset authorization probe"
    );
    await must(
      admin.from("workspace_reset_operations").delete().eq("id", adminProbeId).eq("workspace_id", workspaceA.id),
      "remove admin authorization probe"
    );
    await must(
      admin
        .from("workspace_members")
        .update({ role: "member" })
        .eq("workspace_id", workspaceA.id)
        .eq("user_id", userB.id),
      "restore temporary regular-member role"
    );

    const recoverableId = randomUUID();
    cleanup.operationIds.push(recoverableId);
    await must(
      clientA.rpc("begin_workspace_data_reset", {
        p_workspace_id: workspaceA.id,
        p_confirmation_name: workspaceA.name,
        p_storage_mode: "recoverable",
        p_setup_mode: "blank",
        p_operation_id: recoverableId,
        p_permanent_phrase: null
      }),
      "begin recoverable reset"
    );
    const replayedBegin = await must(
      clientA.rpc("begin_workspace_data_reset", {
        p_workspace_id: workspaceA.id,
        p_confirmation_name: workspaceA.name,
        p_storage_mode: "recoverable",
        p_setup_mode: "blank",
        p_operation_id: recoverableId,
        p_permanent_phrase: null
      }),
      "idempotent begin replay"
    );
    assert.equal(replayedBegin.idempotent, true, "reused operation ID with identical parameters must be idempotent");
    const concurrentAttempt = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(concurrentAttempt.error, "a concurrent reset must be denied");
    const racingStoragePath = `${workspaceA.id}/${randomUUID()}/manifest-race.csv`;
    const racingUpload = await clientA.storage
      .from("workspace-files")
      .upload(racingStoragePath, Buffer.from("metric,value\nrace,1\n"), { contentType: "text/csv", upsert: false });
    assert(racingUpload.error, "direct authenticated Storage uploads must be denied while the reset manifest is active");
    await prepareManifest(clientA, workspaceA, "recoverable", "blank", recoverableId, fixtureA.storagePath, null, false);
    await must(
      clientA.rpc("reset_workspace_data", {
        p_workspace_id: workspaceA.id,
        p_confirmation_name: workspaceA.name,
        p_storage_mode: "recoverable",
        p_setup_mode: "blank",
        p_operation_id: recoverableId
      }),
      "recoverable reset"
    );
    assertWorkspaceCounts(await workspaceCounts(workspaceA.id), 0, "recoverable reset target");
    assertWorkspaceCounts(await workspaceCounts(workspaceB.id), 1, "recoverable reset isolated workspace");
    await assertPreservedData(fixtureA.preservedIds, "recoverable reset target");
    assert.equal((await admin.storage.from("workspace-files").download(fixtureA.storagePath)).error, null, "recoverable storage must remain");
    assert((await clientA.storage.from("workspace-files").download(fixtureA.storagePath)).error, "retained reset storage must be quarantined from normal member access");
    assert.equal((await admin.storage.from("workspace-files").download(fixtureB.storagePath)).error, null, "other workspace storage must remain");

    const postResetSignal = await insertOne(
      "tasks",
      { workspace_id: workspaceA.id, title: "Post-reset content must block snapshot merge", created_by: userA.id },
      "create post-reset conflict fixture"
    );
    const unsafeMerge = await clientA.rpc("restore_workspace_data", {
      p_workspace_id: workspaceA.id,
      p_operation_id: recoverableId
    });
    assert(unsafeMerge.error, "restore must not merge an old snapshot into post-reset business content");
    await must(admin.from("tasks").delete().eq("id", postResetSignal.id).eq("workspace_id", workspaceA.id), "remove post-reset conflict fixture");

    await must(clientA.rpc("restore_workspace_data", { p_workspace_id: workspaceA.id, p_operation_id: recoverableId }), "restore reset");
    assertWorkspaceCounts(await workspaceCounts(workspaceA.id), 1, "recoverable restore target");
    assert.equal((await clientA.storage.from("workspace-files").download(fixtureA.storagePath)).error, null, "restored storage must be readable again");
    await must(clientA.rpc("restore_workspace_data", { p_workspace_id: workspaceA.id, p_operation_id: recoverableId }), "idempotent restore");
    assertWorkspaceCounts(await workspaceCounts(workspaceA.id), 1, "idempotent recoverable restore target");
    const restoredOperation = await must(
      admin
        .from("workspace_reset_operations")
        .select("workspace_context_before")
        .eq("id", recoverableId)
        .eq("workspace_id", workspaceA.id)
        .single(),
      "load restored reset operation"
    );
    assert.deepEqual(restoredOperation.workspace_context_before, {}, "restored operations must not retain recovery-only workspace context");
    const { count: restoredManifestCount, error: restoredManifestError } = await admin
      .from("workspace_reset_storage_objects")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", recoverableId)
      .eq("workspace_id", workspaceA.id);
    if (restoredManifestError) throw restoredManifestError;
    assert.equal(restoredManifestCount, 0, "restored operations must atomically remove exact storage paths");

    await must(
      clientA.rpc("update_source_file_lifecycle", {
        p_workspace_id: workspaceA.id,
        p_file_id: fixtureA.fileId,
        p_action: "delete"
      }),
      "soft-delete source fixture"
    );
    assert((await clientA.storage.from("workspace-files").download(fixtureA.storagePath)).error, "soft-deleted source storage must leave normal product access immediately");

    const unauthorizedPurgeClaim = await clientA.rpc("claim_source_file_purge", {
      p_workspace_id: workspaceA.id,
      p_file_id: fixtureA.fileId
    });
    assert(unauthorizedPurgeClaim.error, "authenticated workspace users must not invoke the service-only source purge claim");

    await must(
      admin
        .from("file_uploads")
        .update({ purge_after: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", fixtureA.fileId)
        .eq("workspace_id", workspaceA.id),
      "make disposable source purge due"
    );
    assert.equal(
      await must(
        admin.rpc("claim_source_file_purge", {
          p_workspace_id: workspaceA.id,
          p_file_id: fixtureA.fileId
        }),
        "claim disposable source purge"
      ),
      true,
      "the service role should claim an eligible source purge exactly once"
    );
    assert.equal(
      await must(
        admin.rpc("claim_source_file_purge", {
          p_workspace_id: workspaceA.id,
          p_file_id: fixtureA.fileId
        }),
        "repeat disposable source purge claim"
      ),
      false,
      "a current source purge claim must not be duplicated"
    );
    const resetDuringSourcePurge = await clientA.rpc("begin_workspace_data_reset", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "recoverable",
      p_setup_mode: "blank",
      p_operation_id: randomUUID(),
      p_permanent_phrase: null
    });
    assert(resetDuringSourcePurge.error, "workspace reset preparation must stop while a source purge claim is active");
    await must(
      admin
        .from("file_uploads")
        .update({ purge_error: null })
        .eq("id", fixtureA.fileId)
        .eq("workspace_id", workspaceA.id),
      "release disposable source purge claim without deleting storage"
    );
    await must(
      clientA.rpc("update_source_file_lifecycle", {
        p_workspace_id: workspaceA.id,
        p_file_id: fixtureA.fileId,
        p_action: "restore"
      }),
      "restore source fixture"
    );
    assert.equal((await clientA.storage.from("workspace-files").download(fixtureA.storagePath)).error, null, "source restore must re-enable private-object access before purge");

    const legalHoldProbeId = randomUUID();
    await prepareManifest(
      clientA,
      workspaceA,
      "permanent",
      "blank",
      legalHoldProbeId,
      fixtureA.storagePath,
      `PERMANENTLY RESET ${workspaceA.name}`
    );
    await must(
      admin
        .from("workspace_reset_storage_objects")
        .update({ legal_hold: true })
        .eq("operation_id", legalHoldProbeId)
        .eq("workspace_id", workspaceA.id),
      "apply disposable storage legal hold"
    );
    const heldPermanentReset = await clientA.rpc("reset_workspace_data", {
      p_workspace_id: workspaceA.id,
      p_confirmation_name: workspaceA.name,
      p_storage_mode: "permanent",
      p_setup_mode: "blank",
      p_operation_id: legalHoldProbeId
    });
    assert(heldPermanentReset.error, "permanent reset must stop before database deletion when storage is under legal hold");
    assertWorkspaceCounts(await workspaceCounts(workspaceA.id), 1, "legal-hold permanent reset probe");
    await must(
      admin.from("workspace_reset_operations").delete().eq("id", legalHoldProbeId).eq("workspace_id", workspaceA.id),
      "remove legal-hold operation probe"
    );

    const permanentId = randomUUID();
    await prepareManifest(
      clientA,
      workspaceA,
      "permanent",
      "blank",
      permanentId,
      fixtureA.storagePath,
      `PERMANENTLY RESET ${workspaceA.name}`
    );
    await must(
      clientA.rpc("reset_workspace_data", {
        p_workspace_id: workspaceA.id,
        p_confirmation_name: workspaceA.name,
        p_storage_mode: "permanent",
        p_setup_mode: "blank",
        p_operation_id: permanentId
      }),
      "permanent database reset"
    );
    await must(admin.storage.from("workspace-files").remove([fixtureA.storagePath]), "permanent Storage API purge");
    await must(
      admin
        .from("workspace_reset_storage_objects")
        .update({ purge_status: "purged", purged_at: new Date().toISOString() })
        .eq("operation_id", permanentId)
        .eq("workspace_id", workspaceA.id),
      "mark storage purged"
    );
    const final = await must(clientA.rpc("finalize_workspace_data_reset", { p_workspace_id: workspaceA.id, p_operation_id: permanentId }), "finalize permanent reset");
    assert.equal(final.status, "completed");
    const finalizedOperation = await must(
      admin
        .from("workspace_reset_operations")
        .select("workspace_context_before")
        .eq("id", permanentId)
        .eq("workspace_id", workspaceA.id)
        .single(),
      "load finalized reset operation"
    );
    assert.deepEqual(finalizedOperation.workspace_context_before, {}, "permanent operations must not retain recovery-only workspace context");
    const { count: finalizedManifestCount, error: finalizedManifestError } = await admin
      .from("workspace_reset_storage_objects")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", permanentId)
      .eq("workspace_id", workspaceA.id);
    if (finalizedManifestError) throw finalizedManifestError;
    assert.equal(finalizedManifestCount, 0, "permanent finalization must atomically remove exact storage paths");
    assert((await admin.storage.from("workspace-files").download(fixtureA.storagePath)).error, "permanent object must be unavailable");
    assertWorkspaceCounts(await workspaceCounts(workspaceA.id), 0, "permanent reset target");
    assertWorkspaceCounts(await workspaceCounts(workspaceB.id), 1, "permanent reset isolated workspace");
    await assertPreservedData(fixtureA.preservedIds, "permanent reset target");
    assert.equal((await admin.storage.from("workspace-files").download(fixtureB.storagePath)).error, null, "other workspace storage must survive permanent reset");

    console.log(`PASS: staging workspace reset lifecycle validated ${RESETTABLE_TABLES.length} resettable tables with isolated disposable fixtures.`);
  } finally {
    if (cleanup.storagePaths.length) await admin.storage.from("workspace-files").remove(cleanup.storagePaths);
    if (cleanup.operationIds.length && cleanup.workspaceIds.length) {
      await admin
        .from("workspace_reset_operations")
        .delete()
        .in("id", cleanup.operationIds)
        .in("workspace_id", cleanup.workspaceIds);
    }
    for (const [table, ids] of Object.entries(cleanup.preservedIds)) {
      if (ids.length && cleanup.workspaceIds.length) {
        await admin.from(table).delete().in("id", ids).in("workspace_id", cleanup.workspaceIds);
      }
    }
    if (cleanup.workspaceIds.length) await admin.from("workspaces").delete().in("id", cleanup.workspaceIds);
    for (const userId of cleanup.userIds) await admin.auth.admin.deleteUser(userId);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
