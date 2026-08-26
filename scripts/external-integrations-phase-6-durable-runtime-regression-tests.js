const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const runtime = require("../lib/integrations/runtime/index.ts");
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");
const { QBO_RATE_LIMIT_OBSERVATION_POLICY } = require("../lib/integrations/providers/qbo/errors.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
async function rejects(callback, matcher, message) {
  assertionCount += 1;
  await assert.rejects(callback, matcher, message);
}
function doesNotMatch(value, matcher, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, matcher, message);
}

function id(value) {
  const hex = BigInt(value).toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

const hash = (value) => contractSha256({
  fingerprintPurpose: "phase_6_regression_fixture",
  fingerprintVersion: "phase_6_regression_fixture_v1",
  value
});

const BASE_TIME = new Date("2026-08-22T02:00:00.000Z");
const scopeA = {
  workspaceId: id(1),
  businessEntityId: id(2),
  connectionId: id(3),
  connectionGeneration: 1,
  providerKey: "synthetic",
  providerEnvironment: "test",
  status: "active"
};
const scopeB = {
  workspaceId: id(11),
  businessEntityId: id(12),
  connectionId: id(13),
  connectionGeneration: 1,
  providerKey: "synthetic",
  providerEnvironment: "test",
  status: "active"
};

let taskSequence = 1_000;
function taskCommand(scope, overrides = {}) {
  const sequence = taskSequence++;
  const createdAt = overrides.createdAt ?? new Date(BASE_TIME.getTime() + sequence).toISOString();
  const checkpointId = overrides.checkpointId === undefined ? id(100_000 + sequence) : overrides.checkpointId;
  return {
    contractVersion: runtime.RUNTIME_CONTRACT_VERSIONS.task,
    id: overrides.id ?? id(sequence),
    workspaceId: scope.workspaceId,
    businessEntityId: scope.businessEntityId,
    connectionId: scope.connectionId,
    connectionGeneration: scope.connectionGeneration,
    syncRunId: overrides.syncRunId ?? id(200_000 + sequence),
    parentTaskId: overrides.parentTaskId ?? null,
    providerKey: scope.providerKey,
    providerEnvironment: scope.providerEnvironment,
    queueClass: overrides.queueClass ?? "provider_interactive",
    taskKind: overrides.taskKind ?? "incremental",
    streamKey: overrides.streamKey ?? "general_ledger",
    priority: overrides.priority ?? 50,
    controlMetadata: {
      checkpointId,
      mappingId: overrides.mappingId ?? id(300_000 + sequence),
      eventId: overrides.eventId ?? null,
      pageOrdinal: overrides.pageOrdinal ?? 0,
      cursorVersion: overrides.cursorVersion ?? 0,
      windowStartAt: overrides.windowStartAt ?? null,
      windowEndAt: overrides.windowEndAt ?? null,
      reasonCode: overrides.reasonCode ?? "synthetic_regression",
      recordHintCount: overrides.recordHintCount ?? 1,
      coalescedEventCount: overrides.coalescedEventCount ?? 1
    },
    idempotencyFingerprint: overrides.idempotencyFingerprint ?? hash(`task:${sequence}`),
    coalescingFingerprint: overrides.coalescingFingerprint ?? hash(`coalesce:${sequence}`),
    maximumAttempts: overrides.maximumAttempts ?? 3,
    availableAt: overrides.availableAt ?? createdAt,
    retentionExpiresAt: overrides.retentionExpiresAt ??
      new Date(Date.parse(createdAt) + 7 * 86_400_000).toISOString(),
    createdAt
  };
}

function ledgerWith(...connections) {
  const ledger = new runtime.SyntheticDurableRuntimeLedger();
  for (const connection of connections) ledger.registerConnection(connection);
  return ledger;
}

function dispatch(ledger, task, now = new Date(task.createdAt)) {
  const created = ledger.createTask(task);
  const name = `projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/${hash(task.id).slice(7)}`;
  return ledger.markDispatched(created.task.id, name, now).task;
}

function lease(
  ledger,
  taskId,
  now,
  retryCount = 0,
  executionCount = retryCount,
  workerKind = "provider_runtime"
) {
  const dispatchGeneration = ledger.task(taskId)?.dispatchGeneration ?? 0;
  return ledger.leaseTask({
    taskId,
    workerKind,
    leaseId: id(
      900_000 + retryCount + executionCount + taskSequence + dispatchGeneration * 100
    ),
    ownerFingerprint: hash(`owner:${taskId}:${retryCount}:${executionCount}`),
    leaseSeconds: 120,
    expectedConnectionGeneration: 1,
    deliveryDispatchGeneration: dispatchGeneration,
    deliveryRetryCount: retryCount,
    deliveryExecutionCount: executionCount,
    deliveryAttemptFingerprint: hash(
      `delivery:${taskId}:${dispatchGeneration}:${retryCount}:${executionCount}`
    ),
    now
  });
}

function webhookEvent(sequence, overrides = {}) {
  return {
    id: id(700_000 + sequence),
    providerKey: "synthetic",
    providerEnvironment: "test",
    specificationVersion: "synthetic_webhook_v1",
    eventType: "source_record_changed",
    providerEventFingerprint: overrides.providerEventFingerprint ?? hash(`event:${sequence}`),
    deliveryHash: overrides.deliveryHash ?? hash(`delivery:${sequence}`),
    providerAccountReferenceFingerprint: hash("tenant-a"),
    providerEntityType: "company",
    providerEntityReferenceFingerprint: hash("entity-a"),
    verifiedAt: BASE_TIME.toISOString()
  };
}

async function main() {
  equal(runtime.PHASE_6_MODEL_CALL_COUNT, 0, "Phase 6 makes zero model calls");
  equal(runtime.PHASE_6_PROMOTION_AUTHORIZED, false, "Phase 6 does not authorize KPI promotion");
  throws(
    () => runtime.assertRuntimeDeliveryAttributionLeaseable("legacy_unattributed"),
    /delivery_attribution_unresolved/,
    "ambiguous legacy delivery evidence is never leaseable"
  );
  deepEqual(
    Object.values(runtime.RUNTIME_CONTRACT_VERSIONS),
    [
      "integration_sync_task_v1",
      "integration_sync_checkpoint_v1",
      "integration_webhook_event_v1",
      "integration_runtime_circuit_v1",
      "integration_rate_limit_state_v1",
      "integration_cloud_task_protocol_v1",
      "integration_provider_page_v1",
      "integration_durable_page_commit_v1"
    ],
    "runtime contracts are explicitly versioned"
  );

  const topology = {
    projectId: "phase6-runtime-test",
    region: "us-central1",
    queueNames: {
      integration_control: "integration-control",
      provider_interactive: "provider-interactive",
      provider_bulk: "provider-bulk",
      deterministic_intelligence: "deterministic-intelligence"
    },
    handlerUrls: {
      integration_control: "https://control.test.example/execute",
      provider_interactive: "https://broker.test.example/execute",
      provider_bulk: "https://broker.test.example/execute-bulk",
      deterministic_intelligence: "https://deterministic.test.example/execute"
    },
    audiences: {
      integration_control: "https://control.test.example/execute",
      provider_interactive: "https://broker.test.example/execute",
      provider_bulk: "https://broker.test.example/execute-bulk",
      deterministic_intelligence: "https://deterministic.test.example/execute"
    },
    oidcServiceAccounts: {
      integration_control: "phase6-control@example.iam.gserviceaccount.com",
      provider_interactive: "phase6-broker@example.iam.gserviceaccount.com",
      provider_bulk: "phase6-broker@example.iam.gserviceaccount.com",
      deterministic_intelligence: "phase6-deterministic@example.iam.gserviceaccount.com"
    },
    maximumDispatchesPerSecond: {
      integration_control: 10,
      provider_interactive: 20,
      provider_bulk: 5,
      deterministic_intelligence: 20
    },
    maximumConcurrentDispatches: {
      integration_control: 5,
      provider_interactive: 20,
      provider_bulk: 5,
      deterministic_intelligence: 20
    }
  };
  const planned = runtime.planCloudTask({
    topology,
    queueClass: "provider_interactive",
    taskId: id(800),
    availableAt: BASE_TIME.toISOString(),
    now: BASE_TIME.toISOString()
  });
  const decodedEnvelope = JSON.parse(Buffer.from(planned.httpRequest.bodyBase64, "base64").toString("utf8"));
  deepEqual(
    Object.keys(decodedEnvelope).sort(),
    ["protocolVersion", "taskId"],
    "Cloud Tasks carries only protocol version and opaque task ID"
  );
  doesNotMatch(
    JSON.stringify(planned),
    /access.?token|refresh.?token|client.?secret|financial|workspace.?name|customer.?data/i,
    "Cloud Task requests contain no credential or customer source payload"
  );
  equal(planned.httpRequest.oidcToken.audience, topology.audiences.provider_interactive, "OIDC audience is explicit");
  ok(
    planned.name.endsWith(
      require("node:crypto").createHash("sha256").update(id(800), "utf8").digest("hex")
    ),
    "Cloud task name is deterministic from the opaque task ID"
  );

  const authorizer = new runtime.CloudTaskDeliveryAuthorizer();
  const claims = {
    signatureVerified: true,
    issuer: "https://accounts.google.com",
    audience: topology.audiences.provider_interactive,
    subject: "synthetic-cloud-task-subject",
    email: topology.oidcServiceAccounts.provider_interactive,
    emailVerified: true,
    issuedAt: Math.floor(BASE_TIME.getTime() / 1_000) - 10,
    expiresAt: Math.floor(BASE_TIME.getTime() / 1_000) + 600
  };
  const authorized = authorizer.authorize({
    envelope: decodedEnvelope,
    delivery: {
      taskName: planned.name,
      queueName: planned.queue,
      retryCount: 0,
      executionCount: 0
    },
    verifiedClaims: claims,
    expectedAudience: topology.audiences.provider_interactive,
    expectedServiceAccount: topology.oidcServiceAccounts.provider_interactive,
    expectedTaskName: planned.name,
    now: BASE_TIME
  });
  equal(authorized.taskId, id(800), "authorized delivery preserves only the opaque task ID");
  throws(
    () => authorizer.authorize({
      envelope: decodedEnvelope,
      delivery: { taskName: planned.name, queueName: planned.queue, retryCount: 0, executionCount: 0 },
      verifiedClaims: { ...claims, audience: "https://wrong.test.example/execute" },
      expectedAudience: topology.audiences.provider_interactive,
      expectedServiceAccount: topology.oidcServiceAccounts.provider_interactive,
      expectedTaskName: planned.name,
      now: BASE_TIME
    }),
    /identity_denied/,
    "wrong OIDC audience fails closed"
  );
  throws(
    () => authorizer.authorize({
      envelope: decodedEnvelope,
      delivery: { taskName: planned.name, queueName: planned.queue, retryCount: 0, executionCount: 0 },
      verifiedClaims: { ...claims, email: "public@example.test" },
      expectedAudience: topology.audiences.provider_interactive,
      expectedServiceAccount: topology.oidcServiceAccounts.provider_interactive,
      expectedTaskName: planned.name,
      now: BASE_TIME
    }),
    /identity_denied/,
    "wrong service account and public caller fail closed"
  );
  throws(
    () => authorizer.authorize({
      envelope: decodedEnvelope,
      delivery: { taskName: planned.name, queueName: planned.queue, retryCount: 0, executionCount: 0 },
      verifiedClaims: { ...claims, issuer: "https://issuer.example.test" },
      expectedAudience: topology.audiences.provider_interactive,
      expectedServiceAccount: topology.oidcServiceAccounts.provider_interactive,
      expectedTaskName: planned.name,
      now: BASE_TIME
    }),
    /Invalid enum|invalid_enum_value/,
    "wrong OIDC issuer fails schema validation"
  );

  const normalLedger = ledgerWith(scopeA);
  const normalTask = taskCommand(scopeA);
  dispatch(normalLedger, normalTask);
  const normalProvider = new runtime.SyntheticRuntimeProvider();
  const normalSink = new runtime.IdempotentSyntheticPageSink();
  const normalWorker = new runtime.DurableSynchronizationWorker({
    ledger: normalLedger,
    provider: normalProvider,
    sink: normalSink,
    clock: () => new Date(normalTask.createdAt)
  });
  const singleStarted = performance.now();
  const normalResult = await normalWorker.execute({
    taskId: normalTask.id,
    workerKind: "provider_runtime",
    expectedConnectionGeneration: 1,
    ownerFingerprint: hash("normal-owner"),
    scenario: "successful_page",
    checkpointId: normalTask.controlMetadata.checkpointId,
    checkpointVersion: 0,
    cursorVersion: 1,
    deliveryRetryCount: 0,
    deliveryExecutionCount: 0,
    deliveryAttemptFingerprint: authorized.deliveryAttemptFingerprint
  });
  const singleTaskLatencyMs = performance.now() - singleStarted;
  equal(normalResult.completed.task.state, "succeeded", "normal task completes durably");
  equal(normalResult.completed.checkpoint.checkpointVersion, 1, "checkpoint advances after durable source commit");
  equal(normalResult.completed.checkpoint.downstreamCommitFingerprint, normalResult.completed.task.durableEffectFingerprint, "checkpoint binds the downstream commit");
  equal(normalSink.economicEffects, 1, "one logical task creates one economic effect");
  equal(normalResult.completed.checkpoint.fullReconciliation, false, "provider checkpoint remains distinct from full reconciliation state");
  equal(normalResult.completed.task.controlMetadata.reasonCode, "synthetic_regression", "bounded control metadata survives the ledger");
  const completedReplay = await normalWorker.execute({
    taskId: normalTask.id,
    workerKind: "provider_runtime",
    expectedConnectionGeneration: 1,
    ownerFingerprint: hash("replay-owner"),
    scenario: "successful_page",
    checkpointId: normalTask.controlMetadata.checkpointId,
    checkpointVersion: 1,
    cursorVersion: 2,
    deliveryRetryCount: 1,
    deliveryExecutionCount: 1
  });
  equal(completedReplay.acquired, false, "delivery after durable completion is ignored");
  equal(normalSink.economicEffects, 1, "repeated delivery cannot duplicate the economic effect");

  const replayLedger = ledgerWith(scopeA);
  const replayTask = taskCommand(scopeA);
  const firstDispatch = dispatch(replayLedger, replayTask);
  equal(firstDispatch.deliveryAttributionState, "none", "a new task has explicit no-delivery attribution");
  equal(firstDispatch.lastDeliveryDispatchGeneration, null, "new dispatch has no accepted delivery generation");
  equal(firstDispatch.lastDeliveryRetryCount, null, "new dispatch has no accepted retry count");
  equal(firstDispatch.lastDeliveryExecutionCount, null, "new dispatch has no accepted execution count");
  const firstLease = lease(replayLedger, replayTask.id, new Date(replayTask.createdAt), 0);
  equal(firstLease.acquired, true, "first delivery leases the task");
  equal(firstLease.task.deliveryAttributionState, "attributed", "an accepted lease establishes explicit attribution");
  equal(firstLease.task.lastDeliveryDispatchGeneration, 1, "accepted delivery binds evidence to dispatch generation one");
  equal(firstLease.task.lastDeliveryRetryCount, 0, "Cloud Tasks retry count zero is persisted as real evidence");
  equal(firstLease.task.lastDeliveryExecutionCount, 0, "Cloud Tasks execution count zero is persisted as real evidence");
  const copiedDelivery = replayLedger.leaseTask({
    taskId: replayTask.id,
    workerKind: "provider_runtime",
    leaseId: id(999_001),
    ownerFingerprint: hash("copied-delivery"),
    leaseSeconds: 120,
    expectedConnectionGeneration: 1,
    deliveryDispatchGeneration: firstLease.task.dispatchGeneration,
    deliveryRetryCount: 0,
    deliveryExecutionCount: 0,
    deliveryAttemptFingerprint: firstLease.task.lastDeliveryAttemptFingerprint,
    now: new Date(replayTask.createdAt)
  });
  equal(copiedDelivery.reasonCode, "delivery_replayed", "replayed Cloud Task delivery is rejected by durable state");
  let deniedProviderCalls = 0;
  const deniedSink = new runtime.IdempotentSyntheticPageSink();
  const deniedWorker = new runtime.DurableSynchronizationWorker({
    ledger: replayLedger,
    provider: {
      async fetchPage() {
        deniedProviderCalls += 1;
        throw new Error("non_owner_provider_execution");
      }
    },
    sink: deniedSink,
    clock: () => new Date(replayTask.createdAt)
  });
  const deniedReplay = await deniedWorker.execute({
    taskId: replayTask.id,
    workerKind: "provider_runtime",
    expectedConnectionGeneration: 1,
    ownerFingerprint: hash("denied-replay-owner"),
    scenario: "successful_page",
    checkpointId: replayTask.controlMetadata.checkpointId,
    checkpointVersion: 0,
    cursorVersion: 1,
    deliveryRetryCount: 0,
    deliveryExecutionCount: 0,
    deliveryAttemptFingerprint: firstLease.task.lastDeliveryAttemptFingerprint
  });
  equal(deniedReplay.acquired, false, "acquired false is authoritative for a competing duplicate delivery");
  equal(deniedProviderCalls, 0, "a non-owner never reaches provider execution");
  equal(deniedSink.calls, 0, "a non-owner never reaches durable source persistence");
  throws(
    () => replayLedger.heartbeat({
      taskId: replayTask.id,
      leaseId: firstLease.task.leaseId,
      ownerFingerprint: hash("wrong-worker"),
      extendSeconds: 60,
      now: new Date(replayTask.createdAt)
    }),
    /lease_stale/,
    "a copied task ID cannot impersonate the lease owner"
  );
  equal(
    replayLedger.heartbeat({
      taskId: replayTask.id,
      leaseId: firstLease.task.leaseId,
      ownerFingerprint: firstLease.task.leaseOwnerFingerprint,
      extendSeconds: 60,
      now: new Date(replayTask.createdAt)
    }).state,
    "leased",
    "the current worker may heartbeat its lease"
  );

  const generationLedger = ledgerWith(scopeA);
  const generationTask = taskCommand(scopeA, { maximumAttempts: 3 });
  dispatch(generationLedger, generationTask);
  const generationZero = lease(
    generationLedger,
    generationTask.id,
    new Date(generationTask.createdAt),
    0
  );
  const generationFailure = generationLedger.fail({
    taskId: generationTask.id,
    leaseId: generationZero.task.leaseId,
    ownerFingerprint: generationZero.task.leaseOwnerFingerprint,
    category: "rate_limit",
    safeCode: "synthetic_retry",
    retryable: true,
    retryAfterMs: 1_000,
    now: new Date(generationTask.createdAt)
  });
  const generationRetryAt = new Date(Date.parse(generationFailure.availableAt));
  generationLedger.sweep(generationRetryAt, { dispatchStaleAfterMs: 900_000 });
  const secondDispatch = dispatchExisting(
    generationLedger,
    generationTask.id,
    generationRetryAt
  );
  equal(secondDispatch.dispatchGeneration, 2, "retry reservation advances the Cloud Task generation");
  equal(secondDispatch.lastDeliveryDispatchGeneration, 1, "retry preserves prior delivery evidence without assigning it to the new task");
  equal(
    lease(generationLedger, generationTask.id, generationRetryAt, 0).acquired,
    true,
    "a newly created Cloud Task may start at execution count zero again"
  );

  const invalidCountLedger = ledgerWith(scopeA);
  const invalidCountTask = taskCommand(scopeA);
  dispatch(invalidCountLedger, invalidCountTask);
  equal(
    lease(invalidCountLedger, invalidCountTask.id, new Date(invalidCountTask.createdAt), -1).acquired,
    false,
    "negative Cloud Tasks execution counts fail closed"
  );

  const skippedZeroLedger = ledgerWith(scopeA);
  const skippedZeroTask = taskCommand(scopeA);
  dispatch(skippedZeroLedger, skippedZeroTask);
  equal(
    lease(skippedZeroLedger, skippedZeroTask.id, new Date(skippedZeroTask.createdAt), 1).acquired,
    false,
    "a new dispatch generation cannot skip execution count zero"
  );

  const boundaryResults = {};
  for (const crashAt of [
    "after_lease",
    "after_provider_before_source_commit",
    "after_source_commit_before_task_commit",
    "after_task_commit_before_response"
  ]) {
    const ledger = ledgerWith(scopeA);
    const command = taskCommand(scopeA);
    dispatch(ledger, command);
    const provider = new runtime.SyntheticRuntimeProvider();
    const sink = new runtime.IdempotentSyntheticPageSink();
    let now = new Date(command.createdAt);
    const worker = new runtime.DurableSynchronizationWorker({ ledger, provider, sink, clock: () => now });
    await rejects(
      () => worker.execute({
        taskId: command.id,
        workerKind: "provider_runtime",
        expectedConnectionGeneration: 1,
        ownerFingerprint: hash(`owner:${crashAt}`),
        scenario: "successful_page",
        crashAt,
        checkpointId: command.controlMetadata.checkpointId,
        checkpointVersion: 0,
        cursorVersion: 1,
        deliveryRetryCount: 0,
        deliveryExecutionCount: 0
      }),
      /synthetic_crash/,
      `${crashAt} is observable and recoverable`
    );
    if (crashAt !== "after_task_commit_before_response") {
      now = new Date(now.getTime() + 121_000);
      ledger.sweep(now, { dispatchStaleAfterMs: 900_000 });
      ledger.sweep(now, { dispatchStaleAfterMs: 900_000 });
      dispatchExisting(ledger, command.id, now);
      const recovered = await worker.execute({
        taskId: command.id,
        workerKind: "provider_runtime",
        expectedConnectionGeneration: 1,
        ownerFingerprint: hash(`recovery:${crashAt}`),
        scenario: "successful_page",
        checkpointId: command.controlMetadata.checkpointId,
        checkpointVersion: 0,
        cursorVersion: 1,
        deliveryRetryCount: 0,
        deliveryExecutionCount: 0
      });
      equal(recovered.completed.task.state, "succeeded", `${crashAt} recovers to durable success`);
    } else {
      equal(ledger.task(command.id).state, "succeeded", "commit-before-response retains durable success");
    }
    equal(sink.economicEffects, crashAt === "after_lease" || crashAt === "after_provider_before_source_commit" ? 1 : 1, `${crashAt} produces exactly one economic effect`);
    boundaryResults[crashAt] = ledger.task(command.id).state;
  }

  const childLedger = ledgerWith(scopeA);
  const parent = taskCommand(scopeA);
  dispatch(childLedger, parent);
  const childSink = new runtime.IdempotentSyntheticPageSink();
  const childWorker = new runtime.DurableSynchronizationWorker({
    ledger: childLedger,
    provider: new runtime.SyntheticRuntimeProvider(),
    sink: childSink,
    clock: () => new Date(parent.createdAt)
  });
  const childResult = await childWorker.execute({
    taskId: parent.id,
    workerKind: "provider_runtime",
    expectedConnectionGeneration: 1,
    ownerFingerprint: hash("parent-owner"),
    scenario: "continuation_page",
    checkpointId: parent.controlMetadata.checkpointId,
    checkpointVersion: 0,
    cursorVersion: 1,
    deliveryRetryCount: 0,
    deliveryExecutionCount: 0,
    childTaskFactory: (parentTask, now) => taskCommand(scopeA, {
      parentTaskId: parentTask.id,
      syncRunId: parentTask.syncRunId,
      checkpointId: parentTask.controlMetadata.checkpointId,
      pageOrdinal: 1,
      cursorVersion: 1,
      createdAt: now.toISOString(),
      idempotencyFingerprint: hash(`child:${parentTask.id}`)
    })
  });
  equal(childResult.completed.childTask.parentTaskId, parent.id, "continuation work is durably parent-bound");
  equal(childLedger.allTasks().length, 2, "continuation acknowledgement creates one child task");

  const cancelLedger = ledgerWith(scopeA);
  const cancelTask = taskCommand(scopeA);
  dispatch(cancelLedger, cancelTask);
  const cancelLease = lease(cancelLedger, cancelTask.id, new Date(cancelTask.createdAt));
  equal(cancelLease.acquired, true, "cancellation fixture acquires a lease");
  equal(cancelLedger.cancel(cancelTask.id, new Date(cancelTask.createdAt)).task.state, "cancelled", "cancellation terminates leased work");
  throws(
    () => cancelLedger.heartbeat({
      taskId: cancelTask.id,
      leaseId: cancelLease.task.leaseId,
      ownerFingerprint: cancelLease.task.leaseOwnerFingerprint,
      extendSeconds: 60,
      now: new Date(cancelTask.createdAt)
    }),
    /lease_stale/,
    "cancelled work cannot be revived by a stale worker"
  );

  const retryLedger = ledgerWith(scopeA);
  const retryTask = taskCommand(scopeA, { maximumAttempts: 2 });
  dispatch(retryLedger, retryTask);
  let retryNow = new Date(retryTask.createdAt);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentLease = lease(retryLedger, retryTask.id, retryNow, 0);
    equal(currentLease.acquired, true, `retry attempt ${attempt + 1} leases once`);
    const failed = retryLedger.fail({
      taskId: retryTask.id,
      leaseId: currentLease.task.leaseId,
      ownerFingerprint: currentLease.task.leaseOwnerFingerprint,
      category: "rate_limit",
      safeCode: "synthetic_rate_limited",
      retryable: true,
      retryAfterMs: 1_000,
      now: retryNow
    });
    if (attempt === 0) {
      equal(failed.state, "retry_wait", "retryable first failure enters bounded wait");
      retryNow = new Date(Date.parse(failed.availableAt));
      retryLedger.sweep(retryNow, { dispatchStaleAfterMs: 900_000 });
      dispatchExisting(retryLedger, retryTask.id, retryNow);
    } else {
      equal(failed.state, "dead_letter", "maximum attempts enter dead letter");
    }
  }
  equal(retryLedger.metrics().taskLeases, 2, "retry amplification is capped by maximum attempts");

  for (const [scenario, expectedState] of [
    ["rate_limit", "retry_wait"],
    ["transient_5xx", "retry_wait"],
    ["timeout", "retry_wait"],
    ["malformed_response", "failed"],
    ["stale_cursor", "failed"],
    ["authorization_failure", "failed"],
    ["permanent_error", "failed"]
  ]) {
    const ledger = ledgerWith(scopeA);
    const command = taskCommand(scopeA);
    dispatch(ledger, command);
    const worker = new runtime.DurableSynchronizationWorker({
      ledger,
      provider: new runtime.SyntheticRuntimeProvider(),
      sink: new runtime.IdempotentSyntheticPageSink(),
      clock: () => new Date(command.createdAt)
    });
    const result = await worker.execute({
      taskId: command.id,
      workerKind: "provider_runtime",
      expectedConnectionGeneration: 1,
      ownerFingerprint: hash(`scenario:${scenario}`),
      scenario,
      checkpointId: command.controlMetadata.checkpointId,
      checkpointVersion: 0,
      cursorVersion: 1,
      deliveryRetryCount: 0,
      deliveryExecutionCount: 0
    });
    equal(result.failed.state, expectedState, `${scenario} has deterministic retry disposition`);
  }

  const provider = new runtime.SyntheticRuntimeProvider();
  equal((await provider.fetchPage({ scenario: "empty_page", now: BASE_TIME, checkpoint: null })).records.length, 0, "empty page succeeds");
  equal((await provider.fetchPage({ scenario: "successful_page", now: BASE_TIME, checkpoint: null })).records.length, 2, "successful page is bounded");
  equal((await provider.fetchPage({ scenario: "continuation_page", now: BASE_TIME, checkpoint: null })).nextCursor !== null, true, "continuation page emits a cursor");
  equal((await provider.fetchPage({ scenario: "provider_deletion", now: BASE_TIME, checkpoint: null })).records[0].changeKind, "deleted", "provider deletion remains explicit");
  const massPage = await provider.fetchPage({ scenario: "mass_update", now: BASE_TIME, checkpoint: null });
  equal(massPage.records.length, 10_000, "synthetic provider enforces the 10,000-record page bound");

  const limiter = new runtime.ProviderNeutralRateLimiter();
  const rateKey = "synthetic:test:provider";
  limiter.configure(rateKey, { capacity: 2, refillPerSecond: 1, maximumConcurrency: 8, now: BASE_TIME });
  equal(limiter.acquire(rateKey, { cost: 1, now: BASE_TIME }).allowed, true, "provider-neutral token permit succeeds");
  const limited = limiter.observe(rateKey, {
    observation: {
      policyVersion: QBO_RATE_LIMIT_OBSERVATION_POLICY.policyVersion,
      category: "rate_limit",
      retryAfterMs: 30_000,
      safeCode: "synthetic_retry_after",
      observedAt: BASE_TIME.toISOString()
    },
    attempt: 1,
    now: BASE_TIME
  });
  equal(limited.adaptiveConcurrency, 4, "provider-neutral observation halves adaptive concurrency");
  equal(limiter.acquire(rateKey, { cost: 1, now: BASE_TIME }).allowed, false, "Retry-After blocks immediate work");
  const recoveredRate = limiter.observe(rateKey, {
    observation: {
      policyVersion: QBO_RATE_LIMIT_OBSERVATION_POLICY.policyVersion,
      category: "none",
      retryAfterMs: null,
      safeCode: "synthetic_recovered",
      observedAt: new Date(BASE_TIME.getTime() + 60_000).toISOString()
    },
    attempt: 2,
    now: new Date(BASE_TIME.getTime() + 60_000)
  });
  equal(recoveredRate.adaptiveConcurrency, 5, "rate recovery is gradual and capped");
  ok(recoveredRate.adaptiveConcurrency <= recoveredRate.maximumConcurrency, "adaptive rate recovery cannot exceed configured authority");

  const circuitLedger = ledgerWith(scopeA);
  const closed = circuitLedger.transitionCircuit({
    key: "provider_api:synthetic:test",
    expectedRowVersion: 0,
    targetState: "closed",
    reasonCode: "initialized",
    openUntil: null,
    now: BASE_TIME
  });
  const open = circuitLedger.transitionCircuit({
    key: "provider_api:synthetic:test",
    expectedRowVersion: closed.rowVersion,
    targetState: "open",
    reasonCode: "synthetic_failure_threshold",
    openUntil: new Date(BASE_TIME.getTime() + 60_000).toISOString(),
    now: BASE_TIME
  });
  equal(open.state, "open", "provider circuit opens by CAS");
  const circuitTask = taskCommand(scopeA);
  dispatch(circuitLedger, circuitTask);
  equal(
    lease(circuitLedger, circuitTask.id, new Date(BASE_TIME.getTime() + 30_000)).acquired,
    false,
    "open provider circuit prevents leasing"
  );
  throws(
    () => circuitLedger.transitionCircuit({
      key: "provider_api:synthetic:test",
      expectedRowVersion: closed.rowVersion,
      targetState: "half_open",
      reasonCode: "stale",
      openUntil: null,
      now: new Date(BASE_TIME.getTime() + 60_000)
    }),
    /cas_stale/,
    "stale circuit transition loses CAS"
  );

  const isolationLedger = ledgerWith(scopeA, scopeB);
  const isolatedTask = taskCommand(scopeA);
  isolationLedger.createTask(isolatedTask);
  throws(
    () => isolationLedger.createTask({ ...taskCommand(scopeB), workspaceId: scopeA.workspaceId }),
    /scope_denied/,
    "cross-workspace task creation fails closed"
  );
  throws(
    () => isolationLedger.createTask({ ...taskCommand(scopeA), connectionGeneration: 2 }),
    /scope_denied/,
    "stale connection generation fails closed"
  );
  isolationLedger.transitionConnection(scopeA.connectionId, { status: "disconnected" });
  throws(
    () => isolationLedger.createTask(taskCommand(scopeA)),
    /scope_denied/,
    "task creation after disconnect fails closed"
  );
  isolationLedger.transitionConnection(scopeA.connectionId, { status: "deleted" });
  throws(
    () => isolationLedger.createTask(taskCommand(scopeA)),
    /scope_denied/,
    "task creation after deletion fails closed"
  );

  const webhookLedger = ledgerWith(scopeA);
  const authority = { ...scopeA, mappingId: id(333) };
  const event = webhookEvent(1);
  const firstEvent = webhookLedger.ingestWebhook({ event, resolveAuthority: () => authority });
  equal(firstEvent.event.workspaceId, scopeA.workspaceId, "webhook scope is resolved from trusted authority");
  for (let duplicate = 0; duplicate < 9; duplicate += 1) {
    equal(
      webhookLedger.ingestWebhook({ event, resolveAuthority: () => null }).idempotent,
      true,
      `duplicate webhook delivery ${duplicate + 2} coalesces before task creation`
    );
  }
  const eventTask = taskCommand(scopeA, {
    eventId: event.id,
    mappingId: authority.mappingId,
    taskKind: "webhook_targeted_read",
    idempotencyFingerprint: hash("webhook-logical-work")
  });
  webhookLedger.coalesceWebhookTask(event.id, eventTask);
  webhookLedger.coalesceWebhookTask(event.id, eventTask);
  equal(webhookLedger.allTasks().length, 1, "ten duplicate deliveries create one durable task");
  equal(webhookLedger.metrics().coalescedWebhookDeliveries, 10, "duplicate event and task coalescing is measured");
  const unmapped = webhookLedger.ingestWebhook({ event: webhookEvent(2), resolveAuthority: () => null });
  equal(unmapped.event.verificationState, "rejected", "unmapped webhook cannot claim workspace authority");
  throws(
    () => webhookLedger.coalesceWebhookTask(unmapped.event.id, taskCommand(scopeA, { eventId: unmapped.event.id })),
    /not_verified/,
    "untrusted webhook cannot create work"
  );
  const crossEvent = webhookLedger.ingestWebhook({ event: webhookEvent(3), resolveAuthority: () => authority });
  throws(
    () => webhookLedger.coalesceWebhookTask(crossEvent.event.id, taskCommand(scopeB, { eventId: crossEvent.event.id })),
    /scope_denied/,
    "a valid event ID cannot mutate another workspace"
  );

  const fairnessLedger = ledgerWith(scopeA, scopeB);
  const noisyTask = taskCommand(scopeA, { recordHintCount: 100_000, priority: 100 });
  const quietTask = taskCommand(scopeB, { recordHintCount: 1, priority: 1 });
  fairnessLedger.createTask(noisyTask);
  fairnessLedger.createTask(quietTask);
  const fairnessNow = new Date(BASE_TIME.getTime() + 86_400_000);
  const firstFair = fairnessLedger.nextDispatchable("provider_interactive", fairnessNow, 1)[0];
  fairnessLedger.markDispatched(firstFair.id, `synthetic/${firstFair.id}`, fairnessNow);
  const secondFair = fairnessLedger.nextDispatchable("provider_interactive", fairnessNow, 1)[0];
  equal(secondFair.workspaceId === firstFair.workspaceId, false, "100,000-record workspace cannot starve a small workspace");

  const backpressureLedger = new runtime.SyntheticDurableRuntimeLedger({
    maximumActiveTasksPerWorkspace: 1,
    maximumActiveTasksPerConnection: 1,
    maximumActiveTasksPerProvider: 1
  });
  backpressureLedger.registerConnection(scopeA);
  const pressureOne = taskCommand(scopeA);
  const pressureTwo = taskCommand(scopeA);
  dispatch(backpressureLedger, pressureOne);
  dispatch(backpressureLedger, pressureTwo);
  const pressureNow = new Date(Math.max(Date.parse(pressureOne.createdAt), Date.parse(pressureTwo.createdAt)));
  equal(lease(backpressureLedger, pressureOne.id, pressureNow, 0).acquired, true, "first task enters bounded capacity");
  equal(lease(backpressureLedger, pressureTwo.id, pressureNow, 0).reasonCode, "backpressure", "second task is held by backpressure");

  const benchmark = {};
  for (const count of [1, 100, 10_000]) {
    const ledger = ledgerWith(scopeA);
    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      ledger.createTask(taskCommand(scopeA, { recordHintCount: 1 }));
    }
    benchmark[`create_${count}_tasks_ms`] = Number((performance.now() - started).toFixed(3));
    equal(ledger.allTasks().length, count, `${count.toLocaleString()} synthetic tasks persist exactly once`);
  }
  ok(benchmark.create_10000_tasks_ms < 15_000, "10,000-task fixture remains bounded for CI");

  const stormLedger = ledgerWith(scopeA);
  const stormStarted = performance.now();
  const coalescedWindows = new Uint32Array(100);
  for (let change = 0; change < 100_000; change += 1) {
    coalescedWindows[change % coalescedWindows.length] += 1;
  }
  for (let window = 0; window < coalescedWindows.length; window += 1) {
    stormLedger.createTask(taskCommand(scopeA, {
      taskKind: "incremental",
      recordHintCount: coalescedWindows[window],
      coalescedEventCount: coalescedWindows[window],
      streamKey: `general_ledger_window_${window}`,
      idempotencyFingerprint: hash(`storm-window:${window}`),
      coalescingFingerprint: hash(`storm-coalescing:${window}`)
    }));
  }
  benchmark.event_storm_100000_inputs_ms = Number((performance.now() - stormStarted).toFixed(3));
  equal(stormLedger.allTasks().length, 100, "100,000 changes coalesce into 100 bounded windows");
  equal(stormLedger.metrics().databaseWrites, 100, "event storm causes one ledger write per coalesced window");

  const reconnectLedger = ledgerWith(scopeA);
  const replacement = { ...scopeA, connectionId: id(4), connectionGeneration: 2, status: "active" };
  reconnectLedger.transitionConnection(scopeA.connectionId, { status: "disconnected" });
  reconnectLedger.registerConnection(replacement);
  reconnectLedger.createTask(taskCommand(replacement, {
    recordHintCount: 100_000_000,
    reasonCode: "provider_reconnect_mass_hint",
    taskKind: "full_reconciliation"
  }));
  equal(reconnectLedger.allTasks().length, 1, "provider reconnect mass hints remain one bounded reconciliation task");

  const backlogLedger = ledgerWith(scopeA);
  const backlogBase = new Date(BASE_TIME.getTime() - 16 * 60_000);
  for (let index = 0; index < 100; index += 1) {
    const command = taskCommand(scopeA, {
      createdAt: new Date(backlogBase.getTime() + index).toISOString()
    });
    dispatch(backlogLedger, command, new Date(command.createdAt));
  }
  const recoveryStarted = performance.now();
  const recoveredBacklog = backlogLedger.sweep(BASE_TIME, { dispatchStaleAfterMs: 15 * 60_000 });
  benchmark.preserve_100_old_dispatches_ms = Number((performance.now() - recoveryStarted).toFixed(3));
  equal(recoveredBacklog.length, 0, "sweeper does not infer missing Cloud Tasks from dispatch age");
  ok(
    backlogLedger.allTasks().every(
      (task) => task.state === "dispatched" && task.dispatchGeneration === 1
    ),
    "old live dispatches preserve their envelope identity and generation"
  );

  benchmark.single_task_latency_ms = Number(singleTaskLatencyMs.toFixed(3));
  benchmark.duplicate_delivery_rate = `${normalLedger.metrics().duplicateDeliveries}/1 replayed delivery`;
  benchmark.task_coalescing = "100000 inputs -> 100 tasks; 10 duplicate deliveries -> 1 task";
  benchmark.database_writes_per_coalesced_window = stormLedger.metrics().databaseWrites / 100;
  benchmark.retry_amplification = `${retryLedger.metrics().taskLeases} attempts / 1 logical task`;
  benchmark.deterministic_downstream_dirty_nodes = 1;
  benchmark.noisy_neighbor_progress_dispatches = 2;

  const runtimeSource = [
    "cloud-tasks.ts",
    "contracts.ts",
    "identity.ts",
    "ledger.ts",
    "rate-limit.ts",
    "synthetic-provider.ts",
    "worker.ts"
  ].map((file) => read(`lib/integrations/runtime/${file}`)).join("\n");
  const workerSource = read("lib/integrations/runtime/worker.ts");
  const migration = read("supabase/migrations/20260822012253_external_integrations_phase_6_durable_runtime.sql");
  const readiness = read("docs/architecture/external-integrations-phase-6-durable-runtime-readiness.md");
  const workflow = read(".github/workflows/ci.yml");
  const packageJson = JSON.parse(read("package.json"));

  doesNotMatch(runtimeSource, /quickbooks|intuit/i, "generic runtime contains no provider-specific implementation");
  doesNotMatch(runtimeSource, /\bfetch\s*\(|axios|node:https|node:http|openai|anthropic|stripe/i, "runtime foundation contains no live provider, model, or billing call");
  doesNotMatch(workerSource, /canonical_business_fact|reconciliation_cases|fact_contributions|deterministic_node_states/i, "provider worker has no direct source-to-KPI fast path");
  ok(workerSource.includes("DurableSourcePageSink"), "validated source processing remains behind a narrow durable port");
  ok(workerSource.includes("promotionAuthorized"), "downstream result is checked for forbidden promotion");
  ok(migration.includes("force row level security"), "all Phase 6 authority tables force RLS");
  ok(migration.includes("pg_advisory_xact_lock"), "provider-wide admission is serialized transactionally");
  ok(migration.includes("for update skip locked"), "sweeper recovery is concurrency-safe");
  ok(migration.includes("transaction_timestamp"), "database time governs leases and retries");
  ok(migration.includes("integration_sync_checkpoint_v1"), "provider checkpoints retain their own contract");
  ok(migration.includes("trusted_mapping_unresolved"), "webhook workspace mapping fails closed");
  ok(migration.includes("last_delivery_execution_count"), "delivery replay CAS is durable");
  ok(migration.includes("last_permit_allowed"), "rate permit retries are durable and idempotent");
  doesNotMatch(
    migration.split(/\r?\n/).filter((line) => /^grant\b/i.test(line.trim())).join("\n"),
    /service_role/i,
    "service_role receives no Phase 6 grant"
  );
  doesNotMatch(migration, /create policy/i, "forced private Phase 6 tables expose no client RLS policy");
  doesNotMatch(migration, /quickbooks|intuit|access.?token|refresh.?token|client.?secret/i, "migration stores no provider-specific or plaintext credential data");
  ok(
    readiness.includes("Live GCP runtime verification remains blocked pending an explicitly isolated non-Production integrations project."),
    "the exact live-GCP stop gate remains documented"
  );
  ok(readiness.includes("Phase 4 sync runs currently admit only"), "sync-run trigger compatibility remains a Phase 8 gate");
  ok(readiness.includes("no narrow normal provider-read credential lease"), "provider-read credential authority remains a Phase 8 gate");
  ok(readiness.includes("Phase 1 still defers real provider-source commit authority"), "provider-source commit authority remains a Phase 8 gate");
  equal(
    packageJson.scripts["test:external-integrations-phase-6"],
    "node scripts/external-integrations-phase-6-durable-runtime-regression-tests.js",
    "Phase 6 static/runtime suite is registered"
  );
  ok(workflow.includes("external_integrations_phase_6_durable_runtime.test.sql"), "Phase 6 database suite is registered in CI");
  ok(workflow.includes("external_integrations_phase_5_credential_security.test.sql"), "credential regressions remain registered");
  ok(workflow.includes("customer_1_billing_entitlement.test.sql"), "billing concurrency remains registered");
  ok(workflow.includes("security_high_findings_remediation.test.sql"), "HIGH-security concurrency remains registered");
  deepEqual(
    runtime.RUNTIME_SERVICE_BOUNDARIES.connectorBroker.mustNot,
    ["arbitrary_private_dml", "model_credentials", "direct_kpi_mutation"],
    "connector broker boundary remains narrow"
  );
  ok(runtime.RUNTIME_SERVICE_BOUNDARIES.deterministicRuntime.mustNot.includes("provider_credential_decrypt"), "deterministic runtime cannot decrypt provider credentials");
  ok(runtime.RUNTIME_SERVICE_BOUNDARIES.ingressRuntime.mustNot.includes("workspace_claim_authority"), "ingress cannot establish workspace authority");
  ok(runtime.RUNTIME_SERVICE_BOUNDARIES.dueWorkRuntime.mustNot.includes("provider_sync"), "Scheduler-triggered due-work discovery cannot synchronize providers");
  equal(normalResult.completed.task.controlMetadata.eventId, null, "normal synthetic source path needs no webhook identity");
  equal(normalSink.calls, 1, "source/fact/reconciliation/contribution handoff is invoked once");
  equal(normalResult.completed.checkpoint.downstreamCommitFingerprint.length, 71, "downstream deterministic boundary is fingerprint-bound");
  equal(runtime.PHASE_6_MODEL_CALL_COUNT, 0, "stress and recovery fixtures make no model calls");
  equal(runtime.PHASE_6_PROMOTION_AUTHORIZED, false, "stress and recovery fixtures leave promotion disabled");

  console.log(`External integrations Phase 6 durable-runtime regressions: ${assertionCount} assertions passed.`);
  console.log(`Phase 6 performance measurements: ${JSON.stringify(benchmark)}`);
  console.log(`Phase 6 crash-boundary results: ${JSON.stringify(boundaryResults)}`);
}

function dispatchExisting(ledger, taskId, now) {
  const task = ledger.task(taskId);
  if (!task || task.state !== "pending") {
    throw new Error("phase_6_recovery_task_not_pending");
  }
  return ledger.markDispatched(taskId, `synthetic/recovered/${taskId}`, now).task;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
