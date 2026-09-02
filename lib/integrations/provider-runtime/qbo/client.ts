import "server-only";

import { parse as parseLosslessJson } from "lossless-json";
import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  QBO_CDC_RESPONSE_OBJECT_CAP,
  QBO_MAX_QUERY_PAGE_SIZE,
  normalizeQboQueryPageSize
} from "@/lib/integrations/providers/qbo/planning";
import {
  QBO_MASTER_RECORD_TYPES,
  QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE,
  QBO_PROVIDER_KEY,
  QBO_REPORT_TYPES,
  QBO_TRANSACTION_RECORD_TYPES,
  QboProviderEndpointClassSchema,
  QboProviderEndpointDomainSchema,
  QboProviderOutcomeSchema,
  QboReportTypeSchema,
  QboSupportedObjectTypeSchema,
  type QboProviderEndpointClass,
  type QboProviderEndpointDomain,
  type QboProviderOutcome,
  type QboReportType,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";
import {
  classifyQboProviderError,
  type QboProviderErrorClassification
} from "@/lib/integrations/providers/qbo/errors";
import { assertQboReadOnlyOperation } from "@/lib/integrations/providers/qbo/read-only";

export const QBO_SANDBOX_API_ORIGIN =
  "https://sandbox-quickbooks.api.intuit.com" as const;
export const QBO_PRODUCTION_API_ORIGIN =
  "https://quickbooks.api.intuit.com" as const;
export const QboProviderEnvironmentSchema = z.enum(["sandbox", "production"]);
export type QboProviderEnvironment = z.infer<typeof QboProviderEnvironmentSchema>;
export const QBO_API_ORIGIN_BY_ENVIRONMENT = {
  sandbox: QBO_SANDBOX_API_ORIGIN,
  production: QBO_PRODUCTION_API_ORIGIN
} as const satisfies Record<QboProviderEnvironment, string>;
export const QBO_RUNTIME_EGRESS_POLICY_VERSION =
  "qbo_runtime_egress_policy_v1" as const;
export const QBO_RUNTIME_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const QBO_RUNTIME_TIMEOUT_MS = 30 * 1_000;

const RealmIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/);
const AccessTokenSchema = z.string().min(16).max(16_384);
const PostingWindowSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
  .strict()
  .refine((value) => value.startDate <= value.endDate, "QBO posting window is inverted");

const queryableTypes = new Set<string>([
  ...QBO_MASTER_RECORD_TYPES,
  ...QBO_TRANSACTION_RECORD_TYPES
]);
const permittedReportIdentifiers = new Set<string>(
  Object.values(QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE)
);

const permittedQueryParameters: Readonly<Record<string, ReadonlySet<string>>> = {
  company_info: new Set(),
  query: new Set(["query"]),
  report: new Set(["start_date", "end_date", "report_date", "accounting_method"]),
  cdc: new Set(["entities", "changedSince"])
};

type JsonRecord = Record<string, unknown>;

export type QboProviderResultObservation = Readonly<{
  endpointDomain: QboProviderEndpointDomain;
  endpointClass: QboProviderEndpointClass;
  providerRequestFingerprint: string;
  providerOutcome: QboProviderOutcome;
}>;

export type QboProviderResultObserver = (
  observation: QboProviderResultObservation
) => PromiseLike<void>;

const REPORT_ENDPOINT_CLASS_BY_TYPE = {
  APAgingSummary: "qbo_report_aged_payables",
  ARAgingSummary: "qbo_report_aged_receivables",
  BalanceSheet: "qbo_report_balance_sheet",
  CashFlow: "qbo_report_cash_flow",
  ProfitAndLoss: "qbo_report_profit_and_loss",
  TrialBalance: "qbo_report_trial_balance"
} as const satisfies Record<QboReportType, QboProviderEndpointClass>;

function object(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonRecord;
}

function boundedIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9._:/-]/g, "_").slice(0, 200) || "unknown";
}

export class QboRuntimeProviderError extends Error {
  readonly classification: QboProviderErrorClassification;

  constructor(classification: QboProviderErrorClassification) {
    super(`qbo_runtime_provider_error:${boundedIdentifier(classification.safeCode)}`);
    this.classification = classification;
  }
}

export type QboRuntimeHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}>;

export type QboRuntimeHttpTransport = Readonly<{
  request(input: Readonly<{
    method: "GET";
    url: string;
    accessToken: string;
    timeoutMs: number;
    maximumResponseBytes: number;
  }>): PromiseLike<QboRuntimeHttpResponse>;
}>;

function routeKind(pathname: string, realmId: string) {
  if (pathname === `/v3/company/${realmId}/companyinfo/${realmId}`) {
    return "company_info" as const;
  }
  if (pathname === `/v3/company/${realmId}/query`) return "query" as const;
  if (pathname === `/v3/company/${realmId}/cdc`) return "cdc" as const;
  const reportPrefix = `/v3/company/${realmId}/reports/`;
  if (
    pathname.startsWith(reportPrefix) &&
    permittedReportIdentifiers.has(pathname.slice(reportPrefix.length))
  ) {
    return "report" as const;
  }
  throw new Error("qbo_runtime_egress_path_denied");
}

export function assertQboRuntimeEgress(input: {
  method: string;
  url: string;
  realmId: string;
  providerEnvironment: QboProviderEnvironment;
  queryText?: string | null;
}) {
  const realmId = RealmIdSchema.parse(input.realmId);
  const providerEnvironment = QboProviderEnvironmentSchema.parse(
    input.providerEnvironment
  );
  const url = new URL(input.url);
  if (
    input.method !== "GET" ||
    url.protocol !== "https:" ||
    url.origin !== QBO_API_ORIGIN_BY_ENVIRONMENT[providerEnvironment] ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("qbo_runtime_egress_destination_denied");
  }
  const kind = routeKind(url.pathname, realmId);
  const allowed = permittedQueryParameters[kind];
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error("qbo_runtime_egress_query_parameter_denied");
    }
  }
  assertQboReadOnlyOperation({
    method: input.method,
    path: url.pathname,
    queryText: input.queryText
  });
  return {
    policyVersion: QBO_RUNTIME_EGRESS_POLICY_VERSION,
    providerKey: QBO_PROVIDER_KEY,
    providerEnvironment,
    routeKind: kind,
    readOnly: true as const
  };
}

export function assertQboSandboxRuntimeEgress(
  input: Omit<Parameters<typeof assertQboRuntimeEgress>[0], "providerEnvironment">
) {
  return assertQboRuntimeEgress({ ...input, providerEnvironment: "sandbox" });
}

function parseJsonResponse(response: QboRuntimeHttpResponse) {
  if (response.body.byteLength === 0 || response.body.byteLength > QBO_RUNTIME_MAX_RESPONSE_BYTES) {
    throw new QboRuntimeProviderError(
      classifyQboProviderError({ httpStatus: response.status })
    );
  }
  const body = Buffer.from(response.body);
  let parsed: unknown;
  try {
    parsed = parseLosslessJson(body.toString("utf8"), null, {
      parseNumber: (value) => value
    });
  } catch {
    throw new QboRuntimeProviderError({
      ...classifyQboProviderError({ httpStatus: response.status }),
      kind: "malformed_response",
      safeCode: "malformed_response",
      retryDisposition: "do_not_retry"
    });
  } finally {
    body.fill(0);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new QboRuntimeProviderError(
      classifyQboProviderError({
        httpStatus: response.status,
        body: parsed,
        headers: { ...response.headers }
      })
    );
  }
  try {
    return object(parsed, "qbo_runtime_response_invalid");
  } catch {
    throw new QboRuntimeProviderError({
      ...classifyQboProviderError({ httpStatus: response.status }),
      kind: "malformed_response",
      safeCode: "malformed_response",
      retryDisposition: "do_not_retry"
    });
  }
}

function queryRecords(root: JsonRecord, recordType: QboSupportedObjectType) {
  const queryResponse = object(root.QueryResponse, "qbo_query_response_invalid");
  const records = queryResponse[recordType];
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw new Error("qbo_query_records_invalid");
  return records;
}

function queryText(input: {
  recordType: QboSupportedObjectType;
  startPosition: number;
  maximumResults: number;
  postingWindow?: z.infer<typeof PostingWindowSchema> | null;
}) {
  if (!queryableTypes.has(input.recordType)) {
    throw new Error("qbo_query_record_type_denied");
  }
  if (!Number.isSafeInteger(input.startPosition) || input.startPosition < 1) {
    throw new Error("qbo_startposition_invalid");
  }
  const maximumResults = normalizeQboQueryPageSize(input.maximumResults);
  const postingWindow = input.postingWindow
    ? PostingWindowSchema.parse(input.postingWindow)
    : null;
  const isTransaction = (QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(
    input.recordType
  );
  if (postingWindow && !isTransaction) {
    throw new Error("qbo_query_posting_window_not_applicable");
  }
  const where = postingWindow
    ? ` WHERE TxnDate >= '${postingWindow.startDate}' AND TxnDate <= '${postingWindow.endDate}'`
    : "";
  return `SELECT * FROM ${input.recordType}${where} STARTPOSITION ${input.startPosition} MAXRESULTS ${maximumResults}`;
}

export class QboReadOnlyClient {
  readonly #realmId: string;
  readonly #providerEnvironment: QboProviderEnvironment;
  readonly #transport: QboRuntimeHttpTransport;
  readonly #providerResultObserver: QboProviderResultObserver | null;

  constructor(input: {
    realmId: string;
    providerEnvironment: QboProviderEnvironment;
    transport: QboRuntimeHttpTransport;
    providerResultObserver?: QboProviderResultObserver;
  }) {
    this.#realmId = RealmIdSchema.parse(input.realmId);
    this.#providerEnvironment = QboProviderEnvironmentSchema.parse(
      input.providerEnvironment
    );
    this.#transport = input.transport;
    this.#providerResultObserver = input.providerResultObserver ?? null;
  }

  get realmId() {
    return this.#realmId;
  }

  get providerEnvironment() {
    return this.#providerEnvironment;
  }

  async #observeProviderResult(input: {
    endpointDomain: QboProviderEndpointDomain;
    endpointClass: QboProviderEndpointClass;
    providerRequestFingerprint: string;
    providerOutcome: QboProviderOutcome;
  }) {
    if (!this.#providerResultObserver) return;
    await this.#providerResultObserver({
      endpointDomain: QboProviderEndpointDomainSchema.parse(input.endpointDomain),
      endpointClass: QboProviderEndpointClassSchema.parse(input.endpointClass),
      providerRequestFingerprint: input.providerRequestFingerprint,
      providerOutcome: QboProviderOutcomeSchema.parse(input.providerOutcome)
    });
  }

  async #get(input: {
    path: string;
    parameters: URLSearchParams;
    accessToken: string;
    queryText?: string;
    endpointDomain: QboProviderEndpointDomain;
    endpointClass: QboProviderEndpointClass;
    requestFingerprintInput: Readonly<Record<string, unknown>>;
  }) {
    const url = new URL(
      input.path,
      QBO_API_ORIGIN_BY_ENVIRONMENT[this.#providerEnvironment]
    );
    url.search = input.parameters.toString();
    assertQboRuntimeEgress({
      method: "GET",
      url: url.toString(),
      realmId: this.#realmId,
      providerEnvironment: this.#providerEnvironment,
      queryText: input.queryText
    });
    const providerRequestFingerprint = contractSha256({
      fingerprintPurpose: "qbo_task_bound_provider_request",
      fingerprintVersion: "qbo_task_bound_provider_request_v1",
      endpointDomain: input.endpointDomain,
      endpointClass: input.endpointClass,
      request: input.requestFingerprintInput
    });
    let response: QboRuntimeHttpResponse;
    try {
      response = await this.#transport.request({
        method: "GET",
        url: url.toString(),
        accessToken: AccessTokenSchema.parse(input.accessToken),
        timeoutMs: QBO_RUNTIME_TIMEOUT_MS,
        maximumResponseBytes: QBO_RUNTIME_MAX_RESPONSE_BYTES
      });
    } catch (error) {
      const providerError = error instanceof QboRuntimeProviderError
        ? error
        : new QboRuntimeProviderError(
        classifyQboProviderError({ httpStatus: null, transportFailure: true })
      );
      await this.#observeProviderResult({
        endpointDomain: input.endpointDomain,
        endpointClass: input.endpointClass,
        providerRequestFingerprint,
        providerOutcome: "provider_transport_failure"
      });
      throw providerError;
    }
    let parsed: JsonRecord;
    try {
      parsed = parseJsonResponse(response);
    } catch (error) {
      const providerError = error instanceof QboRuntimeProviderError
        ? error
        : new QboRuntimeProviderError({
            ...classifyQboProviderError({ httpStatus: response.status }),
            kind: "malformed_response",
            safeCode: "malformed_response",
            retryDisposition: "do_not_retry"
          });
      await this.#observeProviderResult({
        endpointDomain: input.endpointDomain,
        endpointClass: input.endpointClass,
        providerRequestFingerprint,
        providerOutcome:
          providerError.classification.kind === "malformed_response"
            ? "provider_schema_failure"
            : "provider_fault"
      });
      throw providerError;
    }
    await this.#observeProviderResult({
      endpointDomain: input.endpointDomain,
      endpointClass: input.endpointClass,
      providerRequestFingerprint,
      providerOutcome: "provider_success"
    });
    return parsed;
  }

  async fetchEntityPage(input: {
    recordType: QboSupportedObjectType;
    startPosition?: number;
    maximumResults?: number;
    postingWindow?: z.infer<typeof PostingWindowSchema> | null;
    accessToken: string;
  }) {
    const recordType = QboSupportedObjectTypeSchema.parse(input.recordType);
    const statement = queryText({
      recordType,
      startPosition: input.startPosition ?? 1,
      maximumResults: input.maximumResults ?? QBO_MAX_QUERY_PAGE_SIZE,
      postingWindow: input.postingWindow
    });
    const root = await this.#get({
      path: `/v3/company/${this.#realmId}/query`,
      parameters: new URLSearchParams({ query: statement }),
      queryText: statement,
      accessToken: input.accessToken,
      endpointDomain: "entity_query",
      endpointClass: "qbo_entity_query",
      requestFingerprintInput: {
        recordType,
        startPosition: input.startPosition ?? 1,
        maximumResults: normalizeQboQueryPageSize(
          input.maximumResults ?? QBO_MAX_QUERY_PAGE_SIZE
        ),
        postingWindow: input.postingWindow ?? null
      }
    });
    const records = queryRecords(root, recordType);
    const startPosition = input.startPosition ?? 1;
    const maximumResults = normalizeQboQueryPageSize(
      input.maximumResults ?? QBO_MAX_QUERY_PAGE_SIZE
    );
    return {
      recordType,
      records,
      startPosition,
      maximumResults,
      nextStartPosition:
        records.length === maximumResults ? startPosition + records.length : null
    } as const;
  }

  async fetchCompanyInfo(input: { accessToken: string }) {
    const root = await this.#get({
      path: `/v3/company/${this.#realmId}/companyinfo/${this.#realmId}`,
      parameters: new URLSearchParams(),
      accessToken: input.accessToken,
      endpointDomain: "company_info",
      endpointClass: "qbo_company_info",
      requestFingerprintInput: { operation: "company_info" }
    });
    return object(root.CompanyInfo, "qbo_company_info_response_invalid");
  }

  async fetchReport(input: {
    reportType: QboReportType;
    startDate: string;
    endDate: string;
    accountingMethod: "Accrual" | "Cash";
    accessToken: string;
  }) {
    const reportType = QboReportTypeSchema.parse(input.reportType);
    const providerReportIdentifier =
      QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE[reportType];
    const window = PostingWindowSchema.parse({
      startDate: input.startDate,
      endDate: input.endDate
    });
    const parameters =
      reportType === "ARAgingSummary" || reportType === "APAgingSummary"
        ? new URLSearchParams({ report_date: window.endDate })
        : new URLSearchParams({
            start_date: window.startDate,
            end_date: window.endDate,
            accounting_method: input.accountingMethod
          });
    return this.#get({
      path: `/v3/company/${this.#realmId}/reports/${providerReportIdentifier}`,
      parameters,
      accessToken: input.accessToken,
      endpointDomain: "report",
      endpointClass: REPORT_ENDPOINT_CLASS_BY_TYPE[reportType],
      requestFingerprintInput: {
        reportType,
        providerReportIdentifier,
        startDate: window.startDate,
        endDate: window.endDate,
        accountingMethod: input.accountingMethod
      }
    });
  }

  async fetchCdc(input: {
    recordTypes: readonly QboSupportedObjectType[];
    changedSince: string;
    accessToken: string;
  }) {
    const recordTypes = input.recordTypes.map((value) =>
      QboSupportedObjectTypeSchema.exclude(QBO_REPORT_TYPES).parse(value)
    );
    if (recordTypes.length === 0 || recordTypes.length > 30 || new Set(recordTypes).size !== recordTypes.length) {
      throw new Error("qbo_cdc_record_types_invalid");
    }
    const changedSince = z.string().datetime({ offset: true }).parse(input.changedSince);
    const root = await this.#get({
      path: `/v3/company/${this.#realmId}/cdc`,
      parameters: new URLSearchParams({
        entities: recordTypes.join(","),
        changedSince
      }),
      accessToken: input.accessToken,
      endpointDomain: "cdc",
      endpointClass: "qbo_cdc",
      requestFingerprintInput: { recordTypes, changedSince }
    });
    const responses = root.CDCResponse;
    if (!Array.isArray(responses)) throw new Error("qbo_cdc_response_invalid");
    const records: Array<{ recordType: QboSupportedObjectType; raw: unknown }> = [];
    for (const response of responses) {
      const queryResponse = object(
        object(response, "qbo_cdc_response_invalid").QueryResponse,
        "qbo_cdc_query_response_invalid"
      );
      for (const recordType of recordTypes) {
        const values = queryResponse[recordType];
        if (values === undefined) continue;
        if (!Array.isArray(values)) throw new Error("qbo_cdc_records_invalid");
        for (const raw of values) records.push({ recordType, raw });
      }
    }
    if (records.length > QBO_CDC_RESPONSE_OBJECT_CAP) {
      throw new Error("qbo_cdc_response_cap_exceeded");
    }
    return { records, observedObjectCount: records.length } as const;
  }
}

export class QboSandboxReadOnlyClient extends QboReadOnlyClient {
  constructor(
    input: Omit<ConstructorParameters<typeof QboReadOnlyClient>[0], "providerEnvironment">
  ) {
    super({ ...input, providerEnvironment: "sandbox" });
  }
}
