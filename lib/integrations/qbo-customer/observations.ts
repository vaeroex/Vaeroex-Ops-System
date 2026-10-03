import type { ContextualEvidenceAuthorityV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { QboBrowser, QboPreview } from "./contracts";

export const QBO_ACCOUNTING_OBSERVATION_LIMIT = 12;
type Source = NonNullable<QboBrowser["detail"]>["source"];
type DocumentAmount = NonNullable<Extract<QboPreview, { kind: "record" }>["amounts"]["total"]>;
export type QboAccountingObservation =
  | Readonly<{ kind: "document_field"; field: "total" | "balance"; money: DocumentAmount }>
  | Readonly<{ kind: "report_summary"; rowNumber: number; depth: number;
      cells: readonly Readonly<{ column: string | null; value: string | null }>[] }>;
export type QboAccountingObservations = Readonly<{
  contractVersion: "qbo_customer_accounting_observations_v1";
  authority: ContextualEvidenceAuthorityV1;
  contentTrust: "untrusted_provider_content";
  additive: false;
  snapshotIntake: "not_connected";
  coverage: "unknown";
  readAt: string;
  provenance: Readonly<Pick<Source, "sourceId" | "providerRecordId" | "recordType" | "validation" | "validationWork" |
    "lifecycle" | "mappingStatus" | "accountingBasis" | "currency" | "temporalBasis" | "postingDate" |
    "periodStart" | "periodEnd" | "effectiveAt" | "sourceTimeZone" | "observedAt" | "synchronizedAt"> & {
      provider: "quickbooks_online"; environment: "production"; connectionId: string | null;
      versionBinding: "current_at_read_not_immutable_citation";
    }> | null;
  status: "available" | "blocked";
  reason: "source_not_selected" | "source_not_active" | "validation_not_complete" | "mapping_not_active" |
    "preview_unavailable" | "document_status_not_active" | "no_supported_fields" | null;
  observations: readonly QboAccountingObservation[];
  truncated: boolean;
}>;

// This is a current-read projection, not an EvidenceCandidate: no confidence,
// immutable citation, economic eligibility or snapshot receipt is invented.
export function qboAccountingObservations(browser: QboBrowser): QboAccountingObservations {
  const source = browser.detail?.source;
  const result: QboAccountingObservations = {
    contractVersion: "qbo_customer_accounting_observations_v1",
    authority: { role: "supporting_context", deterministicIntelligenceWins: true,
      originalEvidenceEligible: false, automaticReconciliation: false },
    contentTrust: "untrusted_provider_content", additive: false, snapshotIntake: "not_connected",
    coverage: "unknown", readAt: browser.readAt,
    provenance: source ? { provider: browser.provider, environment: browser.environment,
      connectionId: browser.connectionId, versionBinding: "current_at_read_not_immutable_citation",
      sourceId: source.sourceId, providerRecordId: source.providerRecordId, recordType: source.recordType,
      validation: source.validation, validationWork: source.validationWork, lifecycle: source.lifecycle,
      mappingStatus: source.mappingStatus, accountingBasis: source.accountingBasis, currency: source.currency,
      temporalBasis: source.temporalBasis, postingDate: source.postingDate, periodStart: source.periodStart,
      periodEnd: source.periodEnd, effectiveAt: source.effectiveAt, sourceTimeZone: source.sourceTimeZone,
      observedAt: source.observedAt, synchronizedAt: source.synchronizedAt } : null,
    status: "blocked", reason: "source_not_selected", observations: [], truncated: false
  };
  if (!source) return result;
  if (source.lifecycle !== "active") return { ...result, reason: "source_not_active" };
  if (source.validation !== "valid" || source.validationWork !== "valid")
    return { ...result, reason: "validation_not_complete" };
  if (source.mappingStatus !== "active") return { ...result, reason: "mapping_not_active" };
  const preview = browser.detail?.value;
  if (!preview || browser.detail?.state !== "available") return { ...result, reason: "preview_unavailable" };
  const observations: QboAccountingObservation[] = [];
  let truncated = false;
  if (preview.kind === "record") {
    if (preview.status !== "active") return { ...result, reason: "document_status_not_active" };
    for (const field of ["total", "balance"] as const) {
      const money = preview.amounts[field];
      if (money) observations.push({ kind: "document_field", field, money: { ...money } });
    }
  } else {
    truncated = preview.truncated;
    for (const [index, row] of preview.rows.entries()) {
      if (row.rowType !== "summary") continue;
      if (observations.length === QBO_ACCOUNTING_OBSERVATION_LIMIT) { truncated = true; break; }
      // Preserve native column labels and strings. A label never establishes a
      // metric identity, a currency conversion, or an economic matching rule.
      observations.push({ kind: "report_summary", rowNumber: index + 1, depth: row.depth,
        cells: preview.columns.map(column => ({ column: column.title,
          value: row.cells.find(cell => cell.columnKey === column.columnKey)?.value ?? null })) });
    }
  }
  return { ...result, status: observations.length ? "available" : "blocked",
    reason: observations.length ? null : "no_supported_fields", observations, truncated };
}
