import { z } from "zod";
import type { Route } from "next";
import {
  QBO_TRANSACTION_RECORD_TYPES,
  QBO_REPORT_TYPES,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema
} from "@/lib/integrations/providers/qbo/contracts";
import { CurrencyCodeSchema, IsoDateSchema, IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";

export const QBO_CUSTOMER_DATA_PATH = "/app/settings/integrations/quickbooks/data";
export const QBO_CUSTOMER_BOUNDS = { pageSize: 25, connections: 100, projectionBytes: 131072,
  reportRows: 200, reportColumns: 16, reportDepth: 12 } as const;
const uuid = z.string().uuid();
const kind = z.enum(["all", "reports", "records"]);
export type QboBrowseQuery = { connectionId: string | null; after: string | null; sourceId: string | null; kind: z.infer<typeof kind> };

export function parseQboBrowseQuery(params: Record<string, string | string[] | undefined>): QboBrowseQuery {
  const optionalId = (key: string) => params[key] === undefined || params[key] === "" ? null : uuid.parse(params[key]);
  const query = { connectionId: optionalId("connectionId"), after: optionalId("after"),
    sourceId: optionalId("sourceId"), kind: kind.parse(params.kind ?? "all") };
  if (!query.connectionId && (query.after || query.sourceId)) throw new Error("qbo_customer_invalid_query");
  return query;
}

export function qboBrowseHref(query: QboBrowseQuery, anchor?: "source-detail"): Route {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return `${QBO_CUSTOMER_DATA_PATH}?${params}${anchor ? `#${anchor}` : ""}` as Route;
}

const record = QboMinimizedSourceRecordSchema.innerType().shape;
const report = QboReportControlObservationSchema.shape;
const money = record.amounts.element;
const RecordPreviewSchema = z.object({
  kind: z.literal("record"), status: record.status,
  temporal: record.temporal,
  accounting: record.accounting.pick({ basis: true, sourceCurrency: true }),
  amounts: z.object({ total: money.optional(), balance: money.optional() }).strict()
}).strict();
const ReportPreviewSchema = z.object({
  kind: z.literal("report"), reportType: report.reportType, reportBasis: report.reportBasis,
  sourceCurrency: report.sourceCurrency, periodStart: report.periodStart, periodEnd: report.periodEnd,
  columns: z.array(report.columns.element.pick({ columnKey: true, title: true })).min(1).max(16),
  rows: z.array(z.object({ depth: z.number().int().min(0).max(12), rowType: z.enum(["data", "section", "summary"]),
    cells: z.array(z.object({ columnKey: z.string().min(1).max(128), value: z.string().max(400).nullable() }).strict()).max(16)
  }).strict()).max(200),
  truncated: z.boolean()
}).strict();
export const QboPreviewSchema = z.discriminatedUnion("kind", [RecordPreviewSchema, ReportPreviewSchema]);
export type QboPreview = z.infer<typeof QboPreviewSchema>;

const SourceSchema = z.object({
  sourceId: uuid, recordType: z.enum([...QBO_TRANSACTION_RECORD_TYPES, ...QBO_REPORT_TYPES]),
  providerRecordId: z.string().max(128).nullable(),
  lifecycle: z.enum(["active", "voided", "deleted", "unavailable"]),
  validation: z.enum(["pending", "valid", "invalid", "quarantined"]),
  validationWork: z.enum(["absent", "pending", "claimed", "valid", "quarantined", "superseded", "conflict"]),
  changeKind: z.enum(["created", "updated", "corrected", "voided", "deleted", "unchanged"]),
  mappingStatus: z.enum(["active", "inactive", "replaced"]),
  temporalBasis: z.enum(["event", "point_in_time", "period"]),
  postingDate: IsoDateSchema.nullable(), periodStart: IsoDateSchema.nullable(), periodEnd: IsoDateSchema.nullable(),
  effectiveAt: IsoTimestampSchema.nullable(), sourceTimeZone: z.string().max(64).nullable(),
  accountingBasis: z.enum(["accrual", "cash", "not_applicable", "unknown"]), currency: CurrencyCodeSchema.nullable(),
  observedAt: IsoTimestampSchema, synchronizedAt: IsoTimestampSchema
}).strict();
const PreviewStateSchema = z.enum(["available", "missing", "restricted", "oversized", "unsupported"]);
const count = z.string().regex(/^(0|[1-9][0-9]*)$/).max(19);
export const QboOperationalMetricsSchema = z.object({
  scope: z.literal("selected_connection_and_category_current_sources"),
  currentSources: count, reportObservations: count, transactionRecords: count,
  validation: z.object({ pending: count, valid: count, invalid: count, quarantined: count }).strict(),
  validationWork: z.object({ absent: count, pending: count, claimed: count, valid: count,
    quarantined: count, superseded: count, conflict: count }).strict(),
  lifecycle: z.object({ active: count, voided: count, deleted: count, unavailable: count }).strict(),
  missingCurrency: count, unknownAccountingBasis: count, missingSourceTimeZone: count, missingTransactionPostingDate: count,
  earliestPostingDate: IsoDateSchema.nullable(), latestPostingDate: IsoDateSchema.nullable(),
  earliestObservedAt: IsoTimestampSchema.nullable(), latestObservedAt: IsoTimestampSchema.nullable(),
  latestSynchronizedAt: IsoTimestampSchema.nullable(),
  byType: z.array(z.object({ recordType: SourceSchema.shape.recordType, count }).strict()).max(18)
}).strict();
const EnvelopeSchema = z.object({
  contractVersion: z.literal("qbo_customer_source_browse_v1"), provider: z.literal("quickbooks_online"),
  environment: z.literal("production"), additive: z.literal(false), coverage: z.literal("unknown"), readAt: IsoTimestampSchema,
  connectionId: uuid.nullable(), kind, pageSize: z.literal(25), nextAfter: uuid.nullable(),
  connections: z.array(z.object({ connectionId: uuid, label: z.string().max(200),
    entityLabel: z.string().max(200), state: z.string().max(64) }).strict()).max(100),
  sources: z.array(SourceSchema).max(25),
  metrics: QboOperationalMetricsSchema,
  detail: z.object({ source: SourceSchema, preview: z.object({ state: PreviewStateSchema,
    value: z.unknown().optional() }).strict() }).strict().nullable()
}).strict();

export function parseQboBrowser(value: unknown) {
  const browser = EnvelopeSchema.parse(value);
  const detail = browser.detail;
  if (!detail) return { ...browser, detail: null };
  const parsed = QboPreviewSchema.safeParse(detail.preview.value);
  const isReport = (QBO_REPORT_TYPES as readonly string[]).includes(detail.source.recordType);
  const compatible = parsed.success && (isReport
    ? parsed.data.kind === "report" && parsed.data.reportType === detail.source.recordType &&
      parsed.data.reportBasis === detail.source.accountingBasis && parsed.data.sourceCurrency === detail.source.currency &&
      parsed.data.periodStart === detail.source.periodStart && parsed.data.periodEnd === detail.source.periodEnd &&
      new Set(parsed.data.columns.map(column => column.columnKey)).size === parsed.data.columns.length &&
      parsed.data.rows.every(row => new Set(row.cells.map(cell => cell.columnKey)).size === row.cells.length)
    : parsed.data.kind === "record" && parsed.data.accounting.basis === detail.source.accountingBasis &&
      parsed.data.accounting.sourceCurrency === detail.source.currency && parsed.data.temporal.postingDate === detail.source.postingDate &&
      Object.values(parsed.data.amounts).every(money => money.currency === detail.source.currency));
  const allowed = ["pending", "valid"].includes(detail.source.validation) &&
    !["quarantined", "superseded", "conflict"].includes(detail.source.validationWork) &&
    !["deleted", "unavailable"].includes(detail.source.lifecycle);
  return { ...browser, detail: { source: detail.source,
    state: !allowed ? "restricted" as const : detail.preview.state === "available" && !compatible
      ? "unsupported" as const : detail.preview.state,
    value: allowed && detail.preview.state === "available" && compatible && parsed.success ? parsed.data : null } };
}
export type QboBrowser = ReturnType<typeof parseQboBrowser>;
