import { z } from "zod";

import {
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoTimestampSchema
} from "@/lib/integrations/contracts/primitives";

export const QBO_PROVIDER_KEY = "quickbooks_online" as const;

export const QboProviderEndpointDomainSchema = z.enum([
  "company_info",
  "entity_query",
  "report",
  "cdc"
]);

export const QboProviderEndpointClassSchema = z.enum([
  "qbo_company_info",
  "qbo_entity_query",
  "qbo_cdc",
  "qbo_report_aged_payables",
  "qbo_report_aged_receivables",
  "qbo_report_balance_sheet",
  "qbo_report_cash_flow",
  "qbo_report_profit_and_loss",
  "qbo_report_trial_balance"
]);

export const QboProviderOutcomeSchema = z.enum([
  "provider_success",
  "provider_fault",
  "provider_transport_failure",
  "provider_schema_failure"
]);

export const QboReportParserOutcomeSchema = z.enum([
  "parser_success",
  "report_header_shape",
  "report_columns_shape",
  "report_rows_shape",
  "report_cell_shape",
  "report_summary_shape",
  "report_metadata_shape",
  "minimization_failure"
]);

export type QboProviderEndpointDomain = z.infer<
  typeof QboProviderEndpointDomainSchema
>;
export type QboProviderEndpointClass = z.infer<
  typeof QboProviderEndpointClassSchema
>;
export type QboProviderOutcome = z.infer<typeof QboProviderOutcomeSchema>;
export type QboReportParserOutcome = z.infer<
  typeof QboReportParserOutcomeSchema
>;
export const QBO_PROVIDER_ADAPTER_VERSION = "qbo_provider_adapter_v1" as const;
export const QBO_SOURCE_RECORD_CONTRACT_VERSION = "qbo_source_record_minimized_v1" as const;
export const QBO_REPORT_CONTRACT_VERSION = "qbo_report_control_observation_v1" as const;
export const QBO_PAGINATION_POLICY_VERSION = "qbo_query_pagination_policy_v1" as const;
export const QBO_CDC_POLICY_VERSION = "qbo_cdc_planning_policy_v1" as const;
export const QBO_HISTORICAL_SYNC_POLICY_VERSION = "qbo_historical_sync_policy_v1" as const;
export const QBO_WEBHOOK_CONTRACT_VERSION = "qbo_cloudevents_change_hint_v1" as const;
export const QBO_WEBHOOK_SIGNATURE_CONTRACT_VERSION = "qbo_webhook_signature_v1" as const;
export const QBO_ERROR_POLICY_VERSION = "qbo_error_rate_limit_policy_v1" as const;
export const QBO_MODEL_CALL_COUNT = 0 as const;

export const QBO_MASTER_RECORD_TYPES = [
  "CompanyInfo",
  "Preferences",
  "Account",
  "Customer",
  "Vendor",
  "Item"
] as const;

export const QBO_TRANSACTION_RECORD_TYPES = [
  "Invoice",
  "Payment",
  "CreditMemo",
  "SalesReceipt",
  "RefundReceipt",
  "Bill",
  "BillPayment",
  "VendorCredit",
  "Purchase",
  "Deposit",
  "Transfer",
  "JournalEntry"
] as const;

export const QBO_REPORT_TYPES = [
  "ProfitAndLoss",
  "BalanceSheet",
  "CashFlow",
  "ARAgingSummary",
  "APAgingSummary",
  "TrialBalance"
] as const;

export const QBO_V1_SUPPORTED_OBJECTS = [
  ...QBO_MASTER_RECORD_TYPES,
  ...QBO_TRANSACTION_RECORD_TYPES,
  ...QBO_REPORT_TYPES
] as const;

export const QBO_V1_UNSUPPORTED_OR_DEFERRED_OBJECTS = [
  "QuickBooksDesktop",
  "WebConnector",
  "Employee",
  "Payroll",
  "TimeActivity",
  "Estimate",
  "PurchaseOrder",
  "Budget",
  "Attachable",
  "BankFeeds",
  "GeneralLedger",
  "InventoryAdjustment",
  "PaymentCard",
  "TaxReturn",
  "CustomFieldPremium"
] as const;

export type QboMasterRecordType = (typeof QBO_MASTER_RECORD_TYPES)[number];
export type QboTransactionRecordType = (typeof QBO_TRANSACTION_RECORD_TYPES)[number];
export type QboReportType = (typeof QBO_REPORT_TYPES)[number];
export type QboSupportedObjectType = (typeof QBO_V1_SUPPORTED_OBJECTS)[number];

export const QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE = {
  ProfitAndLoss: "ProfitAndLoss",
  BalanceSheet: "BalanceSheet",
  CashFlow: "CashFlow",
  ARAgingSummary: "AgedReceivables",
  APAgingSummary: "AgedPayables",
  TrialBalance: "TrialBalance"
} as const satisfies Readonly<Record<QboReportType, string>>;

export type QboProviderReportIdentifier =
  (typeof QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE)[QboReportType];

export const QboSupportedObjectTypeSchema = z.enum(QBO_V1_SUPPORTED_OBJECTS);
export const QboReportTypeSchema = z.enum(QBO_REPORT_TYPES);

export const QboAccountingBasisSchema = z.enum(["accrual", "cash", "unknown"]);
export type QboAccountingBasis = z.infer<typeof QboAccountingBasisSchema>;

export const QboProviderMetadataSchema = z
  .object({
    providerKey: z.literal(QBO_PROVIDER_KEY),
    realmId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
    sourceEnvironment: z.enum(["sandbox", "production", "unknown"])
  })
  .strict();

export type QboProviderMetadata = Readonly<z.infer<typeof QboProviderMetadataSchema>>;

export const QboRecordMetadataSchema = z
  .object({
    providerCreatedAt: IsoTimestampSchema.nullable(),
    providerUpdatedAt: IsoTimestampSchema.nullable(),
    syncToken: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).nullable()
  })
  .strict();

const qboReferenceSchema = z
  .object({
    value: z.string().min(1).max(128),
    name: z.string().min(1).max(200).nullable()
  })
  .strict();

const qboMoneySchema = z
  .object({
    amount: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/),
    currency: CurrencyCodeSchema
  })
  .strict();

const qboLineSchema = z
  .object({
    lineId: z.string().min(1).max(128).nullable(),
    detailType: z.string().min(1).max(128).nullable(),
    amount: qboMoneySchema.nullable(),
    postingType: z.enum(["debit", "credit", "unknown"]).nullable(),
    itemRef: qboReferenceSchema.nullable(),
    accountRef: qboReferenceSchema.nullable(),
    entityRef: qboReferenceSchema.nullable()
  })
  .strict();

export const QboMinimizedSourceRecordSchema = z
  .object({
    contractVersion: z.literal(QBO_SOURCE_RECORD_CONTRACT_VERSION),
    provider: QboProviderMetadataSchema,
    recordType: QboSupportedObjectTypeSchema.exclude(QBO_REPORT_TYPES),
    id: z.string().min(1).max(128),
    displayName: z.string().min(1).max(200).nullable(),
    active: z.boolean().nullable(),
    status: z.enum(["active", "inactive", "voided", "deleted", "unknown"]),
    metadata: QboRecordMetadataSchema,
    temporal: z
      .object({
        postingDate: IsoDateSchema.nullable(),
        providerCreatedAt: IsoTimestampSchema.nullable(),
        providerUpdatedAt: IsoTimestampSchema.nullable()
      })
      .strict(),
    accounting: z
      .object({
        basis: QboAccountingBasisSchema,
        sourceCurrency: CurrencyCodeSchema.nullable(),
        homeCurrency: CurrencyCodeSchema.nullable(),
        exchangeRate: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/).nullable()
      })
      .strict(),
    relationships: z.record(qboReferenceSchema.nullable()),
    amounts: z.record(qboMoneySchema),
    lines: z.array(qboLineSchema).max(500),
    providerVersionReference: z.string().min(1).max(128).nullable(),
    minimizationVersion: z.literal("qbo_minimizer_v1")
  })
  .strict()
  .superRefine((value, context) => {
    const transactionTypes: ReadonlySet<string> = new Set(QBO_TRANSACTION_RECORD_TYPES);
    if (transactionTypes.has(value.recordType) && value.accounting.sourceCurrency === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accounting", "sourceCurrency"],
        message: "QBO transaction records require source currency metadata"
      });
    }
  });

export type QboMinimizedSourceRecord = Readonly<
  z.infer<typeof QboMinimizedSourceRecordSchema>
>;

const qboReportCellSchema = z
  .object({
    columnKey: z.string().min(1).max(128),
    value: z.string().max(400).nullable(),
    id: z.string().min(1).max(128).nullable()
  })
  .strict();

export const QboReportRowSchema: z.ZodType<{
  rowType: "data" | "section" | "summary";
  group: string | null;
  cells: z.infer<typeof qboReportCellSchema>[];
  children: {
    rowType: "data" | "section" | "summary";
    group: string | null;
    cells: z.infer<typeof qboReportCellSchema>[];
    children: unknown[];
  }[];
}> = z.lazy(() =>
  z
    .object({
      rowType: z.enum(["data", "section", "summary"]),
      group: z.string().min(1).max(128).nullable(),
      cells: z.array(qboReportCellSchema).max(256),
      children: z.array(QboReportRowSchema).max(2_000)
    })
    .strict()
);

export const QboReportControlObservationSchema = z
  .object({
    contractVersion: z.literal(QBO_REPORT_CONTRACT_VERSION),
    provider: QboProviderMetadataSchema,
    reportType: QboReportTypeSchema,
    reportBasis: QboAccountingBasisSchema,
    sourceCurrency: CurrencyCodeSchema.nullable(),
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    columns: z.array(
      z
        .object({
          columnKey: z.string().min(1).max(128),
          title: z.string().max(200).nullable(),
          type: z.string().max(128).nullable()
        })
        .strict()
    ).min(1).max(256),
    rows: z.array(QboReportRowSchema).max(2_000),
    contributionFamily: z.literal("control_observation"),
    additive: z.literal(false),
    parserVersion: z.literal("qbo_report_parser_v1")
  })
  .strict();

export type QboReportControlObservation = Readonly<
  z.infer<typeof QboReportControlObservationSchema>
>;

export function assertQboSupportedObjectType(value: string): QboSupportedObjectType {
  return QboSupportedObjectTypeSchema.parse(value);
}

export function isQboReportType(value: string): value is QboReportType {
  return (QBO_REPORT_TYPES as readonly string[]).includes(value);
}
