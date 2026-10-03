import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import {
  completeQboRuntimeTask,
  recordQboProviderResult,
  recordQboReportParserResult
} from "@/lib/integrations/persistence/qbo-production-repository";
import { commitProviderExternalSourceRecordVersion } from "@/lib/integrations/persistence/provider-source-repository";
import { validateQboProductionSourcePage } from "@/lib/integrations/persistence/qbo-production-validation-repository";
import {
  PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION,
  readProviderExternalSourceRecordState
} from "@/lib/integrations/persistence/provider-validation-repository";
import { QboReadOnlyClient, type QboRuntimeHttpTransport } from "@/lib/integrations/provider-runtime/qbo/client";
import { FetchQboRuntimeTransport } from "@/lib/integrations/provider-runtime/qbo/fetch-transport";
import {
  QBO_REPORT_TYPES,
  QBO_TRANSACTION_RECORD_TYPES,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema,
  QboReportParserOutcomeSchema,
  type QboReportType,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";
import { minimizeQboSourceRecord } from "@/lib/integrations/providers/qbo/minimizers";
import { parseQboCdcTombstone, type QboCdcTombstone } from "@/lib/integrations/providers/qbo/tombstones";
import { fetchCompleteQboCdc } from "./cdc";
import { QboReportContractError, parseQboReport } from "@/lib/integrations/providers/qbo/reports";
import {
  qboMinimizedRecordToExternalSourceVersion,
  qboCdcTombstoneToExternalSourceVersion,
  assertQboCdcTombstoneBinding,
  qboReportProviderRecordId,
  qboReportToExternalSourceVersion
} from "@/lib/integrations/providers/qbo/source-records";
import { RUNTIME_CONTRACT_VERSIONS, RuntimeCheckpointCommitSchema } from "@/lib/integrations/runtime/contracts";

export type QboProductionLeasedTask = Readonly<{
  taskId: string;
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  syncRunId: string;
  streamKey: string;
  taskKind: string;
  controlMetadata: {
    checkpointId: string | null;
    mappingId: string | null;
    pageOrdinal: number;
    cursorVersion: number;
    windowStartAt: string | null;
    windowEndAt: string | null;
  };
  rowVersion: number;
}>;

const entityStreams: Readonly<Record<string, QboSupportedObjectType>> = {
  accounts: "Account",
  company_info: "CompanyInfo",
  preferences: "Preferences",
  customers_minimized: "Customer",
  vendors_minimized: "Vendor",
  items_minimized: "Item",
  qbo_bill: "Bill",
  qbo_billpayment: "BillPayment",
  qbo_creditmemo: "CreditMemo",
  qbo_deposit: "Deposit",
  qbo_invoice: "Invoice",
  qbo_journalentry: "JournalEntry",
  qbo_payment: "Payment",
  qbo_purchase: "Purchase",
  qbo_refundreceipt: "RefundReceipt",
  qbo_salesreceipt: "SalesReceipt",
  qbo_transfer: "Transfer",
  qbo_vendorcredit: "VendorCredit"
};
const reportStreams: Readonly<Record<string, QboReportType>> = {
  qbo_apagingsummary: "APAgingSummary",
  qbo_aragingsummary: "ARAgingSummary",
  qbo_balancesheet: "BalanceSheet",
  qbo_cashflow: "CashFlow",
  qbo_profitandloss: "ProfitAndLoss",
  qbo_trialbalance: "TrialBalance"
};

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceContext(input: {
  task: QboProductionLeasedTask;
  providerTenantReferenceFingerprint: string;
  connectionConfigurationVersion: number;
  mappingVersion: number;
}) {
  return {
    workspaceId: input.task.workspaceId,
    businessEntityId: input.task.businessEntityId,
    connectionId: input.task.connectionId,
    providerKey: "quickbooks_online" as const,
    providerEnvironment: "production" as const,
    providerTenantReferenceFingerprint: input.providerTenantReferenceFingerprint,
    connectionConfigurationVersion: input.connectionConfigurationVersion,
    mappingVersion: input.mappingVersion
  };
}

function sourceStateCommand(task: QboProductionLeasedTask, leaseId: string, owner: string, recordType: string, recordId: string) {
  if (!task.controlMetadata.mappingId) throw new Error("qbo_production_mapping_missing");
  return {
    contractVersion: PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION,
    taskId: task.taskId,
    leaseId,
    leaseOwnerFingerprint: owner,
    mappingId: task.controlMetadata.mappingId,
    providerRecordType: recordType,
    providerRecordId: recordId
  } as const;
}

async function commitEntity(input: {
  task: QboProductionLeasedTask;
  leaseId: string;
  owner: string;
  raw: unknown;
  recordType: QboSupportedObjectType;
  realmId: string;
  providerTenantReferenceFingerprint: string;
  connectionConfigurationVersion: number;
  mappingVersion: number;
  sourceClient: ExternalIntegrationsRpcClient;
  now: string;
  tombstone?: QboCdcTombstone | null;
}) {
  const mappingId = input.task.controlMetadata.mappingId;
  if (!mappingId) throw new Error("qbo_production_mapping_missing");
  const record = input.tombstone ?? minimizeQboSourceRecord({
    recordType: input.recordType,
    raw: input.raw,
    provider: { providerKey: "quickbooks_online", realmId: input.realmId, sourceEnvironment: "production" }
  });
  const state = await readProviderExternalSourceRecordState(
    sourceStateCommand(input.task, input.leaseId, input.owner, input.recordType, record.id),
    input.sourceClient
  );
  if (input.tombstone && state.state === "available" && state.changeKind === "deleted" &&
      state.normalizedProjection === null && state.providerVersionReference === input.tombstone.providerVersionReference) {
    return null;
  }
  const previous = !input.tombstone && state.state === "available" && state.normalizedProjection
    ? QboMinimizedSourceRecordSchema.parse(state.normalizedProjection)
    : null;
  const versionInput = {
    context: sourceContext(input),
    id: randomUUID(),
    immutableVersion: state.state === "available" ? state.immutableVersion + 1 : 1,
    priorVersionId: state.state === "available" ? state.currentVersionId : null,
    observedAt: input.now,
    synchronizedAt: input.now,
    ingestedAt: input.now,
    receivedAt: input.now
  };
  const version = input.tombstone
    ? qboCdcTombstoneToExternalSourceVersion({ ...versionInput, tombstone: input.tombstone,
        taskId: input.task.taskId, connectionGeneration: input.task.connectionGeneration })
    : qboMinimizedRecordToExternalSourceVersion({ ...versionInput,
        record: QboMinimizedSourceRecordSchema.parse(record), previousRecord: previous });
  if (version.changeKind === "unchanged") return null;
  return commitProviderExternalSourceRecordVersion(
    {
      taskId: input.task.taskId,
      leaseId: input.leaseId,
      leaseOwnerFingerprint: input.owner,
      mappingId,
      version
    },
    `qbo_source_${randomUUID()}`,
    input.sourceClient
  );
}

async function commitReport(input: {
  task: QboProductionLeasedTask;
  leaseId: string;
  owner: string;
  raw: unknown;
  reportType: QboReportType;
  realmId: string;
  providerTenantReferenceFingerprint: string;
  connectionConfigurationVersion: number;
  mappingVersion: number;
  sourceClient: ExternalIntegrationsRpcClient;
  runtimeClient: ExternalIntegrationsRpcClient;
  providerResultEvidenceId: string;
  now: string;
}) {
  const mappingId = input.task.controlMetadata.mappingId;
  if (!mappingId) throw new Error("qbo_production_mapping_missing");
  const recordParserResult = (parserOutcome: unknown) =>
    recordQboReportParserResult(
      {
        providerResultEvidenceId: input.providerResultEvidenceId,
        parserOutcome: QboReportParserOutcomeSchema.parse(parserOutcome)
      },
      `qbo_parser_${randomUUID()}`,
      input.runtimeClient
    );
  let report: ReturnType<typeof parseQboReport>;
  try {
    report = parseQboReport({
      reportType: input.reportType,
      raw: input.raw,
      provider: { providerKey: "quickbooks_online", realmId: input.realmId, sourceEnvironment: "production" }
    });
  } catch (error) {
    if (error instanceof QboReportContractError) await recordParserResult(error.diagnosticClass);
    throw error;
  }
  const recordId = qboReportProviderRecordId(report);
  const state = await readProviderExternalSourceRecordState(
    sourceStateCommand(input.task, input.leaseId, input.owner, report.reportType, recordId),
    input.sourceClient
  );
  const previous = state.state === "available" && state.normalizedProjection
    ? QboReportControlObservationSchema.parse(state.normalizedProjection)
    : null;
  let version: ReturnType<typeof qboReportToExternalSourceVersion>;
  try {
    version = qboReportToExternalSourceVersion({
      context: sourceContext(input),
      report,
      previousReport: previous,
      id: randomUUID(),
      immutableVersion: state.state === "available" ? state.immutableVersion + 1 : 1,
      priorVersionId: state.state === "available" ? state.currentVersionId : null,
      observedAt: input.now,
      synchronizedAt: input.now,
      ingestedAt: input.now,
      receivedAt: input.now
    });
  } catch (error) {
    await recordParserResult("minimization_failure");
    throw error;
  }
  await recordParserResult("parser_success");
  if (version.changeKind === "unchanged") return null;
  return commitProviderExternalSourceRecordVersion(
    {
      taskId: input.task.taskId,
      leaseId: input.leaseId,
      leaseOwnerFingerprint: input.owner,
      mappingId,
      version
    },
    `qbo_report_${randomUUID()}`,
    input.sourceClient
  );
}

export async function executeQboProductionRead(input: {
  task: QboProductionLeasedTask;
  leaseId: string;
  owner: string;
  accessToken: string;
  credentialReadEvidenceId: string;
  realmId: string;
  providerTenantReferenceFingerprint: string;
  connectionConfigurationVersion: number;
  mappingVersion: number;
  runtimeClient: ExternalIntegrationsRpcClient;
  sourceClient: ExternalIntegrationsRpcClient;
  transport?: QboRuntimeHttpTransport;
  now?: () => Date;
}) {
  let ordinal = 0;
  let reportEvidenceId: string | null = null;
  const cdcEvidence = new Map<string, string>();
  const client = new QboReadOnlyClient({
    realmId: input.realmId,
    providerEnvironment: "production",
    transport: input.transport ?? new FetchQboRuntimeTransport(),
    providerResultObserver: async (observation) => {
      ordinal += 1;
      const evidence = await recordQboProviderResult(
        { credentialReadEvidenceId: input.credentialReadEvidenceId, requestOrdinal: ordinal, ...observation },
        `qbo_provider_result_${randomUUID()}`,
        input.runtimeClient
      );
      if (observation.endpointDomain === "report" && observation.providerOutcome === "provider_success") {
        reportEvidenceId = evidence.providerResultEvidenceId;
      }
      if (observation.endpointDomain === "cdc" && observation.providerOutcome === "provider_success") {
        cdcEvidence.set(observation.providerRequestFingerprint, evidence.providerResultEvidenceId);
      }
    }
  });
  const now = (input.now?.() ?? new Date()).toISOString();
  const common = { ...input, now };
  const committed: Array<{ sourceVersionId: string; sourceFingerprint: string }> = [];
  let observed = 0;
  let nextStartPosition: number | null = null;
  let cdcRequestCount = 0;
  let providerWatermarkAt = now;
  const entityType = entityStreams[input.task.streamKey];
  const reportType = reportStreams[input.task.streamKey];
  if (input.task.streamKey === "qbo_cdc") {
    if (!input.task.controlMetadata.windowStartAt || !input.task.controlMetadata.windowEndAt) {
      throw new Error("qbo_production_cdc_window_missing");
    }
    const page = await fetchCompleteQboCdc({ client, changedSince: input.task.controlMetadata.windowStartAt,
      until: input.task.controlMetadata.windowEndAt, accessToken: input.accessToken, now: input.now });
    providerWatermarkAt = page.watermarkAt;
    observed = page.records.length;
    cdcRequestCount = page.requestCount;
    const observedAt = (input.now?.() ?? new Date()).toISOString();
    // Validate every sparse deletion and its exact successful request before any source writes.
    const records = page.records.map(item => {
      const providerResultEvidenceId = cdcEvidence.get(item.providerRequestFingerprint);
      if (!providerResultEvidenceId) throw new Error("qbo_production_cdc_evidence_missing");
      const tombstone = parseQboCdcTombstone({ raw: item.raw, recordType: item.recordType,
        provider: { providerKey: "quickbooks_online", realmId: input.realmId, sourceEnvironment: "production" },
        evidence: { taskId: input.task.taskId, connectionId: input.task.connectionId,
          connectionGeneration: input.task.connectionGeneration, providerResultEvidenceId,
          providerRequestFingerprint: item.providerRequestFingerprint } });
      if (tombstone) assertQboCdcTombstoneBinding({ context: sourceContext(input),
        taskId: input.task.taskId, connectionGeneration: input.task.connectionGeneration, tombstone, observedAt });
      return { ...item, tombstone };
    });
    for (const item of records) {
      const result = await commitEntity({ ...common, now: observedAt, raw: item.raw, recordType: item.recordType, tombstone: item.tombstone });
      if (result) committed.push(result);
    }
  } else if (entityType) {
    const records = entityType === "CompanyInfo"
      ? [await client.fetchCompanyInfo({ accessToken: input.accessToken })]
      : (await client.fetchEntityPage({
          recordType: entityType,
          startPosition: input.task.controlMetadata.pageOrdinal * 500 + 1,
          maximumResults: 500,
          postingWindow: (QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(entityType) && input.task.controlMetadata.windowStartAt && input.task.controlMetadata.windowEndAt
            ? { startDate: input.task.controlMetadata.windowStartAt.slice(0, 10), endDate: input.task.controlMetadata.windowEndAt.slice(0, 10) }
            : null,
          accessToken: input.accessToken
        })).records;
    observed = records.length;
    nextStartPosition = records.length === 500 ? input.task.controlMetadata.pageOrdinal * 500 + 501 : null;
    for (const raw of records) {
      const result = await commitEntity({ ...common, raw, recordType: entityType });
      if (result) committed.push(result);
    }
  } else if (reportType && (QBO_REPORT_TYPES as readonly string[]).includes(reportType)) {
    if (!input.task.controlMetadata.windowStartAt || !input.task.controlMetadata.windowEndAt) {
      throw new Error("qbo_production_report_window_missing");
    }
    const raw = await client.fetchReport({
      reportType,
      startDate: input.task.controlMetadata.windowStartAt.slice(0, 10),
      endDate: input.task.controlMetadata.windowEndAt.slice(0, 10),
      accountingMethod: "Accrual",
      accessToken: input.accessToken
    });
    observed = 1;
    if (!reportEvidenceId) throw new Error("qbo_production_report_evidence_missing");
    const result = await commitReport({ ...common, raw, reportType, providerResultEvidenceId: reportEvidenceId });
    if (result) committed.push(result);
  } else {
    throw new Error("qbo_production_stream_key_denied");
  }

  // Persisted pages must be validated before their checkpoint can advance. The
  // database also fences outstanding claims held by another validation worker.
  let validationDrained = false;
  for (let page = 0; page < 200; page++) {
    const validation = await validateQboProductionSourcePage({
      taskId: input.task.taskId,
      workerFingerprint: input.owner,
      maximumResults: 100,
      requestId: `qbo_validate_${randomUUID()}`
    }, input.sourceClient);
    if (validation.results.some((result) => result.state === "quarantined")) {
      throw new Error("qbo_production_source_quarantined");
    }
    if (!validation.fullPage) { validationDrained = true; break; }
  }
  if (!validationDrained) throw new Error("qbo_production_validation_page_limit");

  const durableEffectFingerprint = contractSha256({
    fingerprintPurpose: "qbo_production_durable_source_page",
    fingerprintVersion: "qbo_production_durable_source_page_v2",
    taskId: input.task.taskId,
    streamKey: input.task.streamKey,
    committed: committed.map((value) => ({ sourceVersionId: value.sourceVersionId, sourceFingerprint: value.sourceFingerprint }))
  });
  const checkpoint = input.task.controlMetadata.checkpointId
    ? RuntimeCheckpointCommitSchema.parse({
        checkpointId: input.task.controlMetadata.checkpointId,
        expectedCheckpointVersion: input.task.controlMetadata.cursorVersion,
        streamKey: input.task.streamKey,
        checkpointKind: "cursor",
        cursorVersion: input.task.controlMetadata.cursorVersion + 1,
        cursor: {
          protocolVersion: RUNTIME_CONTRACT_VERSIONS.checkpoint,
          cursorKind: "cursor",
          cursorValue: nextStartPosition === null ? "complete" : `start_${nextStartPosition}`,
          windowStartAt: input.task.controlMetadata.windowStartAt,
          windowEndAt: input.task.controlMetadata.windowEndAt
        },
        cursorFingerprint: contractSha256({
          fingerprintPurpose: "qbo_production_checkpoint_cursor",
          fingerprintVersion: "qbo_production_checkpoint_cursor_v2",
          streamKey: input.task.streamKey,
          nextStartPosition,
          pageOrdinal: input.task.controlMetadata.pageOrdinal
        }),
        providerWatermarkAt,
        overlapSeconds: 300,
        fullReconciliation: input.task.taskKind === "full_reconciliation",
        downstreamCommitFingerprint: durableEffectFingerprint
      })
    : null;
  const continuation = nextStartPosition === null ? null : {
    kind: "next_page" as const,
    childTaskId: deterministicUuid(`qbo_production_page_v2:${input.task.taskId}:${input.task.controlMetadata.pageOrdinal + 1}`)
  };
  const completed = await completeQboRuntimeTask(
    {
      completion: {
        workspaceId: input.task.workspaceId,
        businessEntityId: input.task.businessEntityId,
        connectionId: input.task.connectionId,
        connectionGeneration: input.task.connectionGeneration,
        taskId: input.task.taskId,
        expectedRowVersion: input.task.rowVersion,
        leaseId: input.leaseId,
        leaseOwnerFingerprint: input.owner,
        durableEffectFingerprint,
        checkpoint
      },
      continuation
    },
    `qbo_complete_${randomUUID()}`,
    "qbo_provider_runtime",
    input.runtimeClient
  );
  return { completed, observed, committed: committed.length, nextStartPosition, cdcRequestCount } as const;
}
