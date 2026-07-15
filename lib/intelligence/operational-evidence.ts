import type { Database, Json } from "@/lib/supabase/types";
import { filterBusinessEvidence, filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import type { IntelligenceEvidenceRecord, IntelligenceInsight } from "@/lib/intelligence/layer";
import { compareKpiRowsNewest, normalizeKpiName } from "@/lib/intelligence/kpi-identity";
import { buildSourceParentEligibility, filterBySourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";

type TableRow<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
type KpiRow = TableRow<"kpis">;
type OperationalMetricRow = TableRow<"operational_metrics">;
type MemoryChunkRow = TableRow<"business_memory_chunks">;
type FileUploadRow = TableRow<"file_uploads">;
type FileImportRow = TableRow<"file_imports">;

type SourceGroup = {
  sourceKey: string;
  sourceFileId: string | null;
  importId: string | null;
  kpis: KpiRow[];
  metrics: OperationalMetricRow[];
  chunks: MemoryChunkRow[];
};

type Trend = {
  name: string;
  rows: KpiRow[];
  first: KpiRow;
  latest: KpiRow;
  firstValue: number;
  latestValue: number;
  changePercent: number | null;
  consistency: number;
};

type CandidateDraft = Omit<IntelligenceInsight, "confidence" | "evidenceCount" | "supportingRecords" | "independentSourceCount" | "sourceTypes"> & {
  kind: string;
  worksheets: string[];
  supportingRecords: IntelligenceEvidenceRecord[];
  sourceTypes?: string[];
};

const MAX_OPERATIONAL_FINDINGS = 6;
const MAX_MEMORY_CITATIONS = 3;
const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function asRecord(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedField(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fieldValue(record: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedField));
  const entry = Object.entries(record).find(([key]) => wanted.has(normalizedField(key)));
  return entry?.[1];
}

function textValue(record: Record<string, unknown>, aliases: string[]) {
  const value = fieldValue(record, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(record: Record<string, unknown>, aliases: string[]) {
  const value = fieldValue(record, aliases);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function worksheetForRaw(raw: Record<string, unknown>) {
  return textValue(raw, ["Vaeroex worksheet", "worksheet"]) || "Imported evidence";
}

function worksheetForChunk(chunk: MemoryChunkRow) {
  return textValue(asRecord(chunk.source_metadata), ["worksheet_name", "worksheet"]);
}

function rowNumberForRaw(raw: Record<string, unknown>) {
  const row = numberValue(raw, ["Vaeroex source row", "row_number", "row"]);
  return row && Number.isInteger(row) && row > 0 ? row : null;
}

function sourceKeyFor(row: Pick<KpiRow | OperationalMetricRow, "source_file_id" | "import_id">) {
  if (row.source_file_id) return `source-file:${row.source_file_id}`;
  if (row.import_id) return `import:${row.import_id}`;
  return null;
}

function sourceHref(sourceFileId: string | null) {
  return sourceFileId ? `/app/sources/${sourceFileId}` : "/app/sources";
}

function importedProvenanceIsEligible(rawValue: Json) {
  const raw = asRecord(rawValue);
  const classification = textValue(raw, ["evidence_classification", "record_classification", "classification"]).toLowerCase();
  const lifecycle = textValue(raw, ["evidence_lifecycle", "lifecycle_status", "record_lifecycle"]).toLowerCase();
  const generatedFrom = textValue(raw, ["generated_from", "generated_by", "source_type"]).toLowerCase();
  const telemetryOnly = fieldValue(raw, ["telemetry_only", "platform_failure"]) === true;
  const setupBootstrap = fieldValue(raw, ["setup_bootstrap", "demo"]) === true;

  if (telemetryOnly || setupBootstrap) return false;
  if (["platform_failure", "platform_telemetry", "telemetry", "invalid_evidence", "user_failure_state"].includes(classification)) return false;
  if (["archived", "deleted", "failed", "inactive", "rejected", "superseded"].includes(lifecycle)) return false;
  if (["setup", "bootstrap", "demo", "generated_output", "operations_intelligence", "period_report"].includes(generatedFrom)) return false;
  return true;
}

function formatMetric(value: number, name: string) {
  if (/revenue|sales|inventory value|amount|cost|expense/i.test(name)) return currencyFormatter.format(value);
  if (/%|margin|return rate|returns rate/i.test(name)) return `${numberFormatter.format(value)}%`;
  return numberFormatter.format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "not available" : `${numberFormatter.format(Math.abs(value))}%`;
}

function countWithShare(count: number, total: number, label: string, trailing = "") {
  const share = total ? Math.round((count / total) * 100) : 0;
  return `${count} ${label}${count === 1 ? "" : "s"}${trailing} (${share}% of ${total})`;
}

function compact(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function latestDate(rows: Array<{ updated_at?: string | null; created_at: string }>) {
  return rows.map((row) => row.updated_at || row.created_at).sort().at(-1) || new Date().toISOString();
}

function periodLabel(first: string, latest: string) {
  return first === latest ? first : `${first} to ${latest}`;
}

function uniqueRecords(records: IntelligenceEvidenceRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function rawRowIdentity(row: OperationalMetricRow) {
  const raw = asRecord(row.raw_data_json);
  const worksheet = worksheetForRaw(raw);
  const rowNumber = rowNumberForRaw(raw);
  return rowNumber ? `${sourceKeyFor(row)}:${worksheet.toLowerCase()}:${rowNumber}` : `metric:${row.id}`;
}

function uniqueMetricRows(rows: OperationalMetricRow[]) {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => rawRowIdentity(a).localeCompare(rawRowIdentity(b)))
    .filter((row) => {
      const key = rawRowIdentity(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function operationalRecord(row: OperationalMetricRow, support: string, value: string): IntelligenceEvidenceRecord {
  const raw = asRecord(row.raw_data_json);
  const worksheet = worksheetForRaw(raw);
  const rowNumber = rowNumberForRaw(raw);
  const sourceKey = sourceKeyFor(row) || `metric:${row.id}`;
  const rawDate = textValue(raw, ["Date", "Due Date", "Period"]);

  return {
    id: `metric:${row.id}`,
    title: rowNumber ? `${worksheet} · row ${rowNumber}` : `${worksheet} · ${row.metric_name}`,
    recordType: "Imported operational record",
    date: /^\d{4}-\d{2}(?:-\d{2})?$/.test(rawDate) ? rawDate : row.created_at,
    value,
    support,
    href: sourceHref(row.source_file_id),
    classification: "Original",
    sourceKey,
    groupHint: worksheet
  };
}

function kpiRecord(row: KpiRow, support: string): IntelligenceEvidenceRecord {
  const raw = asRecord(row.raw_data_json);
  const worksheet = worksheetForRaw(raw);
  const rowNumber = rowNumberForRaw(raw);
  const sourceKey = sourceKeyFor(row) || `manual-kpi:${normalizeKpiName(row.name)}`;

  return {
    id: `kpi:${row.id}`,
    title: rowNumber ? `${row.name} · ${worksheet} row ${rowNumber}` : row.name,
    recordType: "Imported KPI measurement",
    date: row.metric_date,
    value: `Actual ${formatMetric(row.actual_value ?? 0, row.name)}${row.target === null ? "" : ` · Target ${formatMetric(row.target, row.name)}`}`,
    support,
    href: sourceHref(row.source_file_id),
    classification: "Original",
    sourceKey,
    groupHint: worksheet
  };
}

function memoryRecord(chunk: MemoryChunkRow, sourceKey: string): IntelligenceEvidenceRecord {
  const worksheet = worksheetForChunk(chunk) || "Business Memory";
  return {
    id: `memory:${chunk.id}`,
    title: chunk.source_title,
    recordType: "Business Memory citation",
    date: chunk.indexed_at,
    value: compact(chunk.source_excerpt, 180),
    support: `Indexed context from ${worksheet}; it supports review of the deterministic records but does not create this finding.`,
    href: sourceHref(chunk.source_file_id),
    classification: "Derived",
    sourceKey,
    groupHint: worksheet
  };
}

function seriesFor(rows: KpiRow[], matcher: RegExp) {
  const matching = rows.filter((row) => matcher.test(normalizeKpiName(row.name)) && row.actual_value !== null && /^\d{4}-\d{2}-\d{2}$/.test(row.metric_date));
  if (!matching.length) return null;

  const byDate = new Map<string, KpiRow>();
  for (const row of [...matching].sort(compareKpiRowsNewest)) {
    if (!byDate.has(row.metric_date)) byDate.set(row.metric_date, row);
  }
  const ordered = Array.from(byDate.values()).sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  if (ordered.length < 3) return null;

  const first = ordered[0];
  const latest = ordered.at(-1)!;
  const firstValue = first.actual_value!;
  const latestValue = latest.actual_value!;
  const changePercent = firstValue === 0 ? null : ((latestValue - firstValue) / Math.abs(firstValue)) * 100;
  const direction = Math.sign(latestValue - firstValue);
  const directionalSteps = ordered.slice(1).filter((row, index) => Math.sign(row.actual_value! - ordered[index].actual_value!) === direction).length;

  return {
    name: latest.name,
    rows: ordered,
    first,
    latest,
    firstValue,
    latestValue,
    changePercent,
    consistency: ordered.length > 1 ? directionalSteps / (ordered.length - 1) : 0
  } satisfies Trend;
}

function aligned(...trends: Array<Trend | null>) {
  const available = trends.filter((trend): trend is Trend => Boolean(trend));
  return available.length === trends.length && new Set(available.map((trend) => trend.first.metric_date)).size === 1 && new Set(available.map((trend) => trend.latest.metric_date)).size === 1;
}

function trendRecords(trend: Trend, direction: string) {
  return trend.rows.map((row, index) => kpiRecord(
    row,
    index === 0
      ? `This is the first value in the ${trend.rows.length}-period comparison.`
      : index === trend.rows.length - 1
        ? `This is the latest value and confirms the ${direction}.`
        : "This measurement establishes the intervening direction."
  ));
}

function relevantMemory(group: SourceGroup, worksheets: string[]) {
  const wanted = new Set(worksheets.map((worksheet) => worksheet.toLowerCase()));
  return group.chunks
    .filter((chunk) => {
      const worksheet = worksheetForChunk(chunk).toLowerCase();
      return !wanted.size || !worksheet || wanted.has(worksheet);
    })
    .sort((a, b) => b.indexed_at.localeCompare(a.indexed_at) || a.chunk_index - b.chunk_index)
    .slice(0, MAX_MEMORY_CITATIONS)
    .map((chunk) => memoryRecord(chunk, group.sourceKey));
}

function completeCandidate(group: SourceGroup, draft: CandidateDraft): IntelligenceInsight {
  const { kind: _kind, worksheets, supportingRecords: draftRecords, sourceTypes: draftSourceTypes, ...insight } = draft;
  const memory = relevantMemory(group, worksheets);
  const supportingRecords = uniqueRecords([...draftRecords, ...memory]);
  const independentSourceCount = new Set(supportingRecords.filter((record) => record.classification !== "Derived").map((record) => record.sourceKey)).size;

  return {
    ...insight,
    confidence: independentSourceCount >= 2 ? "High" : "Medium",
    evidenceCount: supportingRecords.length,
    supportingRecords,
    independentSourceCount,
    sourceTypes: [...new Set([...(draftSourceTypes || ["Imported operational evidence"]), ...(memory.length ? ["Business Memory"] : [])])]
  };
}

function statusRows(rows: OperationalMetricRow[], fieldAliases: string[], value: string) {
  return rows.filter((row) => textValue(asRecord(row.raw_data_json), fieldAliases).toLowerCase() === value.toLowerCase());
}

function worksheetRows(rows: OperationalMetricRow[], pattern: RegExp) {
  return rows.filter((row) => pattern.test(worksheetForRaw(asRecord(row.raw_data_json)).toLowerCase()));
}

function candidateDrafts(group: SourceGroup) {
  const drafts: CandidateDraft[] = [];
  const rows = uniqueMetricRows(group.metrics);
  const returns = seriesFor(group.kpis, /^(returns?|return rate|returns rate)( %| percentage)?$/);
  const margin = seriesFor(group.kpis, /^gross margin( %| percentage)?$/);
  const revenue = seriesFor(group.kpis, /^revenue$/);
  const transactions = seriesFor(group.kpis, /^transactions?$/);
  const inventoryValue = seriesFor(group.kpis, /^inventory value$/);
  const onlineSales = seriesFor(group.kpis, /^online sales$/);
  const returnsAdverse = returns && returns.latestValue - returns.firstValue >= 1 && returns.consistency >= 0.6;
  const marginAdverse = margin && margin.firstValue - margin.latestValue >= 1 && margin.consistency >= 0.6;
  const revenueAdverse = revenue && (revenue.changePercent ?? 0) <= -5 && revenue.consistency >= 0.6;
  const transactionsAdverse = transactions && (transactions.changePercent ?? 0) <= -5 && transactions.consistency >= 0.6;
  const inventoryRising = inventoryValue && (inventoryValue.changePercent ?? 0) >= 10 && inventoryValue.consistency >= 0.6;
  const onlineRising = onlineSales && (onlineSales.changePercent ?? 0) >= 10 && onlineSales.consistency >= 0.6;
  const workbookSheet = [...group.kpis.map((row) => worksheetForRaw(asRecord(row.raw_data_json)))].filter(Boolean);

  if (returnsAdverse && marginAdverse && aligned(returns, margin)) {
    drafts.push({
      kind: "margin-returns",
      id: `operational-margin-returns-${group.sourceKey}`,
      type: "Risk",
      title: "Margin and returns are moving in the wrong direction",
      summary: `Gross margin declined from ${formatMetric(margin.firstValue, margin.name)} to ${formatMetric(margin.latestValue, margin.name)}, while returns increased from ${formatMetric(returns.firstValue, returns.name)} to ${formatMetric(returns.latestValue, returns.name)} across ${margin.rows.length} periods.`,
      why: "The two metrics moved adversely over the same dated period.",
      impact: "Lower margin and higher returns can place pressure on profitability, but this evidence does not quantify that impact.",
      recommendedAction: "Review return reasons and margin performance by product or location.",
      evidence: [`Gross margin change: ${formatMetric(margin.firstValue, margin.name)} to ${formatMetric(margin.latestValue, margin.name)}`, `Returns change: ${formatMetric(returns.firstValue, returns.name)} to ${formatMetric(returns.latestValue, returns.name)}`],
      contradictoryEvidence: [],
      missingEvidence: ["Product- or location-level causes", "Confirmed financial impact"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate([...margin.rows, ...returns.rows]),
      affectedArea: "Profitability and returns",
      timePeriod: periodLabel(margin.first.metric_date, margin.latest.metric_date),
      limitation: "The workbook shows co-movement, not causation.",
      fingerprint: "operational:margin-returns",
      worksheets: workbookSheet,
      supportingRecords: [...trendRecords(margin, "decline"), ...trendRecords(returns, "increase")]
    });
  }

  if (returnsAdverse && !marginAdverse) {
    drafts.push({
      kind: "returns-increase",
      id: `operational-returns-increase-${group.sourceKey}`,
      type: "Risk",
      title: "Returns increased across the available periods",
      summary: `Returns increased from ${formatMetric(returns.firstValue, returns.name)} to ${formatMetric(returns.latestValue, returns.name)} across ${returns.rows.length} periods.`,
      why: "A higher returns rate is an approved adverse direction and the dated values moved consistently upward.",
      impact: "The evidence establishes a worsening returns trend but not its cause or financial impact.",
      recommendedAction: "Review return reasons by product, channel, or location.",
      evidence: [`Returns change: ${formatMetric(returns.firstValue, returns.name)} to ${formatMetric(returns.latestValue, returns.name)}`],
      contradictoryEvidence: [],
      missingEvidence: ["Return reasons", "Confirmed financial impact"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate(returns.rows),
      affectedArea: "Returns",
      timePeriod: periodLabel(returns.first.metric_date, returns.latest.metric_date),
      limitation: "The history establishes direction, not cause.",
      fingerprint: "operational:returns-increase",
      worksheets: workbookSheet,
      supportingRecords: trendRecords(returns, "increase")
    });
  }

  if (marginAdverse && !returnsAdverse) {
    drafts.push({
      kind: "margin-decline",
      id: `operational-margin-decline-${group.sourceKey}`,
      type: "Risk",
      title: "Gross margin declined across the available periods",
      summary: `Gross margin declined from ${formatMetric(margin.firstValue, margin.name)} to ${formatMetric(margin.latestValue, margin.name)} across ${margin.rows.length} periods.`,
      why: "A lower gross margin is an approved adverse direction and the dated values moved consistently downward.",
      impact: "The evidence establishes margin compression but not its cause or total financial impact.",
      recommendedAction: "Review margin movement by product, channel, or location.",
      evidence: [`Gross margin change: ${formatMetric(margin.firstValue, margin.name)} to ${formatMetric(margin.latestValue, margin.name)}`],
      contradictoryEvidence: [],
      missingEvidence: ["Product or channel mix", "Confirmed cause"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate(margin.rows),
      affectedArea: "Gross margin",
      timePeriod: periodLabel(margin.first.metric_date, margin.latest.metric_date),
      limitation: "The history establishes direction, not cause.",
      fingerprint: "operational:margin-decline",
      worksheets: workbookSheet,
      supportingRecords: trendRecords(margin, "decline")
    });
  }

  const inventoryRows = worksheetRows(rows, /inventory/);
  const belowReorder = inventoryRows.filter((row) => {
    const raw = asRecord(row.raw_data_json);
    const onHand = numberValue(raw, ["On Hand", "Quantity On Hand"]);
    const reorder = numberValue(raw, ["Reorder Point", "Reorder Level"]);
    return onHand !== null && reorder !== null && onHand < reorder;
  });
  const salesDeclines = [revenueAdverse ? revenue : null, transactionsAdverse ? transactions : null].filter((trend): trend is Trend => Boolean(trend));
  if (inventoryRising && salesDeclines.length && salesDeclines.every((trend) => aligned(inventoryValue, trend))) {
    const salesText = salesDeclines.map((trend) => `${trend.name.toLowerCase()} declined ${formatPercent(trend.changePercent)}`).join(" and ");
    drafts.push({
      kind: "inventory-sales",
      id: `operational-inventory-sales-${group.sourceKey}`,
      type: "Risk",
      title: "Inventory increased while sales activity declined",
      summary: `Inventory value rose from ${formatMetric(inventoryValue.firstValue, inventoryValue.name)} to ${formatMetric(inventoryValue.latestValue, inventoryValue.name)} while ${salesText}.${belowReorder.length ? ` ${countWithShare(belowReorder.length, inventoryRows.length, "inventory item", " below reorder level")}.` : ""}`,
      why: "Inventory and sales activity moved in opposite directions over aligned periods.",
      impact: "The records show inventory accumulation alongside specific replenishment exceptions; they do not establish the cause.",
      recommendedAction: "Review accumulated inventory separately from items requiring replenishment.",
      evidence: [`Inventory value increased ${formatPercent(inventoryValue.changePercent)}`, ...salesDeclines.map((trend) => `${trend.name} changed ${numberFormatter.format(trend.changePercent || 0)}%`), `Below reorder level: ${belowReorder.length}`],
      contradictoryEvidence: [],
      missingEvidence: ["Category-level inventory value", "Confirmed demand and purchasing causes"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate([...inventoryValue.rows, ...salesDeclines.flatMap((trend) => trend.rows), ...belowReorder]),
      affectedArea: "Inventory and sales",
      timePeriod: periodLabel(inventoryValue.first.metric_date, inventoryValue.latest.metric_date),
      limitation: "The aligned movements are correlated observations and do not prove that declining sales caused inventory growth.",
      fingerprint: "operational:inventory-sales",
      worksheets: [...workbookSheet, ...belowReorder.map((row) => worksheetForRaw(asRecord(row.raw_data_json)))],
      supportingRecords: [
        ...trendRecords(inventoryValue, "increase"),
        ...salesDeclines.flatMap((trend) => trendRecords(trend, "decline")),
        ...belowReorder.map((row) => {
          const raw = asRecord(row.raw_data_json);
          return operationalRecord(row, "On-hand inventory is below the recorded reorder point.", `${textValue(raw, ["SKU", "Item"]) || row.metric_name}: ${numberValue(raw, ["On Hand"]) ?? "not set"} on hand vs ${numberValue(raw, ["Reorder Point"]) ?? "not set"} reorder point`);
        })
      ]
    });
  }

  const orderRows = worksheetRows(rows, /orders?/);
  const feedbackRows = worksheetRows(rows, /feedback|customer/);
  const delayed = statusRows(orderRows, ["Status"], "Delayed");
  const complaints = orderRows.filter((row) => /^(yes|true|1)$/i.test(textValue(asRecord(row.raw_data_json), ["Customer Complaint", "Complaint"])));
  const lowRatings = feedbackRows.filter((row) => {
    const rating = numberValue(asRecord(row.raw_data_json), ["Rating", "Customer Rating"]);
    return rating !== null && rating <= 2;
  });
  const unresolved = feedbackRows.filter((row) => /^(no|false|0|unresolved)$/i.test(textValue(asRecord(row.raw_data_json), ["Resolved", "Resolution Status"])));
  if (delayed.length || complaints.length || lowRatings.length || unresolved.length) {
    const facts = [
      delayed.length ? countWithShare(delayed.length, orderRows.length, "delayed order") : "",
      complaints.length ? countWithShare(complaints.length, orderRows.length, "order", " with customer complaints") : "",
      lowRatings.length ? countWithShare(lowRatings.length, feedbackRows.length, "feedback rating", " of two or lower") : "",
      unresolved.length ? countWithShare(unresolved.length, feedbackRows.length, "unresolved feedback record") : ""
    ].filter(Boolean);
    const exceptionRows = uniqueMetricRows([...delayed, ...complaints, ...lowRatings, ...unresolved]);
    drafts.push({
      kind: "customer-order-exceptions",
      id: `operational-customer-order-${group.sourceKey}`,
      type: "Risk",
      title: "Customer and order exceptions require attention",
      summary: `${facts.join(", ")}.`,
      why: "The imported records explicitly identify fulfillment and customer-service exceptions.",
      impact: "The evidence establishes exception volume, but not a confirmed revenue or retention effect.",
      recommendedAction: "Review fulfillment delays and unresolved customer cases, starting with the oldest records.",
      evidence: facts,
      contradictoryEvidence: [],
      missingEvidence: ["Resolution age", "Confirmed customer or revenue outcome"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate(exceptionRows),
      affectedArea: "Orders and customer feedback",
      timePeriod: "Current imported records",
      limitation: "Exception counts do not establish why the conditions occurred or their business impact.",
      fingerprint: "operational:customer-order-exceptions",
      worksheets: exceptionRows.map((row) => worksheetForRaw(asRecord(row.raw_data_json))),
      supportingRecords: exceptionRows.map((row) => {
        const raw = asRecord(row.raw_data_json);
        const value = [textValue(raw, ["Order", "Customer"]), textValue(raw, ["Status", "Resolved"]), textValue(raw, ["Rating"])].filter(Boolean).join(" · ");
        return operationalRecord(row, "This row contains an explicit order or customer exception.", value || row.metric_name);
      })
    });
  }

  const supplierRows = worksheetRows(rows, /supplier|invoice/);
  const overdue = statusRows(supplierRows, ["Status"], "Overdue");
  if (overdue.length) {
    const overdueAmount = overdue.reduce((total, row) => total + (numberValue(asRecord(row.raw_data_json), ["Amount", "Invoice Amount"]) || 0), 0);
    drafts.push({
      kind: "overdue-suppliers",
      id: `operational-overdue-suppliers-${group.sourceKey}`,
      type: "Risk",
      title: "Supplier invoices include overdue obligations",
      summary: `${countWithShare(overdue.length, supplierRows.length, "supplier invoice", " explicitly marked overdue")}${overdueAmount ? `, totaling ${currencyFormatter.format(overdueAmount)}` : ""}.`,
      why: "The source records explicitly label these invoices as overdue.",
      impact: "The records establish overdue obligations but do not confirm supplier disruption or cash-flow impact.",
      recommendedAction: "Confirm payment status and operational dependency for the overdue suppliers.",
      evidence: [`Overdue invoices: ${overdue.length}`, ...(overdueAmount ? [`Recorded overdue amount: ${currencyFormatter.format(overdueAmount)}`] : [])],
      contradictoryEvidence: [],
      missingEvidence: ["Current payment status", "Supplier dependency"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "Medium",
      lastUpdated: latestDate(overdue),
      affectedArea: "Supplier obligations",
      timePeriod: "Current imported records",
      limitation: "An overdue label does not prove that payment remains outstanding today.",
      fingerprint: "operational:overdue-suppliers",
      worksheets: overdue.map((row) => worksheetForRaw(asRecord(row.raw_data_json))),
      supportingRecords: overdue.map((row) => {
        const raw = asRecord(row.raw_data_json);
        return operationalRecord(row, "The invoice status is explicitly recorded as overdue.", `${textValue(raw, ["Invoice"]) || row.metric_name} · ${currencyFormatter.format(numberValue(raw, ["Amount"]) || 0)}`);
      })
    });
  }

  const storeRows = worksheetRows(rows, /store performance|stores?/).filter((row) => textValue(asRecord(row.raw_data_json), ["Store", "Location"]));
  const margins = storeRows.map((row) => ({ row, value: numberValue(asRecord(row.raw_data_json), ["Gross Margin %", "Gross Margin"]) })).filter((item): item is { row: OperationalMetricRow; value: number } => item.value !== null);
  const overtime = storeRows.map((row) => ({ row, value: numberValue(asRecord(row.raw_data_json), ["Overtime Hours", "OT Hours"]) })).filter((item): item is { row: OperationalMetricRow; value: number } => item.value !== null);
  const marginMin = margins.length ? Math.min(...margins.map((item) => item.value)) : null;
  const marginMax = margins.length ? Math.max(...margins.map((item) => item.value)) : null;
  const overtimeMin = overtime.length ? Math.min(...overtime.map((item) => item.value)) : null;
  const overtimeMax = overtime.length ? Math.max(...overtime.map((item) => item.value)) : null;
  const materialMargin = marginMin !== null && marginMax !== null && marginMax - marginMin >= 10;
  const materialOvertime = overtimeMin !== null && overtimeMax !== null && overtimeMax - overtimeMin >= 20 && (overtimeMin === 0 || overtimeMax / overtimeMin >= 1.5);
  if (materialMargin || materialOvertime) {
    const facts = [
      materialMargin ? `gross margin ranges from ${numberFormatter.format(marginMin!)}% to ${numberFormatter.format(marginMax!)}%` : "",
      materialOvertime ? `overtime ranges from ${numberFormatter.format(overtimeMin!)} to ${numberFormatter.format(overtimeMax!)} hours` : ""
    ].filter(Boolean);
    drafts.push({
      kind: "store-variation",
      id: `operational-store-variation-${group.sourceKey}`,
      type: "Anomaly",
      title: "Store performance varies materially",
      summary: `${facts.join(", and ")}.`,
      why: "The spread crosses the fixed launch threshold of 10 margin points or 20 overtime hours with at least a 1.5x range.",
      impact: "The variation identifies locations for comparison; it does not prove underperformance or its cause.",
      recommendedAction: "Compare low-margin or high-overtime locations with stronger stores using the underlying records.",
      evidence: facts,
      contradictoryEvidence: [],
      missingEvidence: ["Store targets", "Comparable store size and operating conditions"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "Medium",
      lastUpdated: latestDate(storeRows),
      affectedArea: "Store performance",
      timePeriod: "Current imported records",
      limitation: "Store differences may reflect size, mix, or local conditions not present in this workbook.",
      fingerprint: "operational:store-variation",
      worksheets: storeRows.map((row) => worksheetForRaw(asRecord(row.raw_data_json))),
      supportingRecords: storeRows.map((row) => {
        const raw = asRecord(row.raw_data_json);
        return operationalRecord(row, "This store record contributes to the measured range.", `${textValue(raw, ["Store", "Location"])} · margin ${numberValue(raw, ["Gross Margin %", "Gross Margin"]) ?? "not set"}% · overtime ${numberValue(raw, ["Overtime Hours", "OT Hours"]) ?? "not set"} hours`);
      })
    });
  }

  if (onlineRising) {
    drafts.push({
      kind: "online-sales-growth",
      id: `operational-online-sales-${group.sourceKey}`,
      type: "Opportunity",
      title: "Online sales are increasing",
      summary: `Online sales increased from ${formatMetric(onlineSales.firstValue, onlineSales.name)} to ${formatMetric(onlineSales.latestValue, onlineSales.name)} across ${onlineSales.rows.length} periods.`,
      why: "The imported KPI history shows a sustained positive directional movement.",
      impact: "The trend is worth reviewing, but the evidence does not establish profitability, attribution, or future growth.",
      recommendedAction: "Review whether online growth is profitable and whether fulfillment capacity is keeping pace.",
      evidence: [`Online sales increased ${formatPercent(onlineSales.changePercent)}`, `Periods: ${onlineSales.rows.length}`],
      contradictoryEvidence: [],
      missingEvidence: ["Channel profitability", "Attribution and fulfillment capacity"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "Medium",
      lastUpdated: latestDate(onlineSales.rows),
      affectedArea: "Online sales",
      timePeriod: periodLabel(onlineSales.first.metric_date, onlineSales.latest.metric_date),
      limitation: "The trend does not prove why online sales increased or whether the increase is profitable.",
      fingerprint: "operational:online-sales-growth",
      worksheets: workbookSheet,
      supportingRecords: trendRecords(onlineSales, "increase")
    });
  }

  const employeeRows = worksheetRows(rows, /employees?|workforce|staff/);
  const inactiveEmployees = employeeRows.filter((row) => {
    const status = textValue(asRecord(row.raw_data_json), ["Status", "Employment Status"]).toLowerCase();
    return Boolean(status) && !["active", "employed"].includes(status);
  });
  if (inactiveEmployees.length) {
    drafts.push({
      kind: "employee-status-exceptions",
      id: `operational-employee-status-${group.sourceKey}`,
      type: "Recommendation",
      title: "Employee records include status exceptions",
      summary: `${countWithShare(inactiveEmployees.length, employeeRows.length, "employee record", " not marked active")}.`,
      why: "The source contains explicit non-active employment statuses.",
      impact: "The records establish status differences but do not show a staffing shortage or performance effect.",
      recommendedAction: "Confirm whether the recorded statuses reflect current workforce availability.",
      evidence: [`Non-active employee records: ${inactiveEmployees.length}`],
      contradictoryEvidence: [],
      missingEvidence: ["Current workforce plan", "Role coverage"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "Low",
      lastUpdated: latestDate(inactiveEmployees),
      affectedArea: "Workforce context",
      timePeriod: "Current imported records",
      limitation: "A non-active status does not establish a staffing gap.",
      fingerprint: "operational:employee-status-exceptions",
      worksheets: inactiveEmployees.map((row) => worksheetForRaw(asRecord(row.raw_data_json))),
      supportingRecords: inactiveEmployees.map((row) => {
        const raw = asRecord(row.raw_data_json);
        return operationalRecord(row, "This row contains an explicit non-active employee status.", `${textValue(raw, ["Employee", "Employee ID"]) || row.metric_name} · ${textValue(raw, ["Status", "Employment Status"])}`);
      })
    });
  }

  if (!returnsAdverse && !marginAdverse && revenueAdverse && !inventoryRising) {
    drafts.push({
      kind: "revenue-decline",
      id: `operational-revenue-decline-${group.sourceKey}`,
      type: "Risk",
      title: "Revenue declined across the available periods",
      summary: `Revenue declined from ${formatMetric(revenue.firstValue, revenue.name)} to ${formatMetric(revenue.latestValue, revenue.name)} across ${revenue.rows.length} periods.`,
      why: "The imported values show a material directional decline.",
      impact: "The trend requires context before it can be tied to a cause or financial outcome.",
      recommendedAction: "Review revenue movement against transactions, margin, and channel mix.",
      evidence: [`Revenue changed ${numberFormatter.format(revenue.changePercent || 0)}%`],
      contradictoryEvidence: [],
      missingEvidence: ["Confirmed cause", "Channel and product mix"],
      sourceHref: sourceHref(group.sourceFileId),
      priority: "High",
      lastUpdated: latestDate(revenue.rows),
      affectedArea: "Revenue",
      timePeriod: periodLabel(revenue.first.metric_date, revenue.latest.metric_date),
      limitation: "The history establishes direction, not cause.",
      fingerprint: "operational:revenue-decline",
      worksheets: workbookSheet,
      supportingRecords: trendRecords(revenue, "decline")
    });
  }

  return drafts;
}

function candidateSort(a: IntelligenceInsight, b: IntelligenceInsight) {
  const priority = { High: 3, Medium: 2, Low: 1 };
  const type = { Risk: 5, Bottleneck: 4, Anomaly: 3, Recommendation: 2, Opportunity: 1, Forecast: 0 };
  return priority[b.priority] - priority[a.priority] || type[b.type] - type[a.type] || b.lastUpdated.localeCompare(a.lastUpdated) || a.id.localeCompare(b.id);
}

export function buildOperationalEvidenceInsights({
  kpis = [],
  operationalMetrics = [],
  memoryChunks = [],
  files = [],
  imports = []
}: {
  kpis?: KpiRow[];
  operationalMetrics?: OperationalMetricRow[];
  memoryChunks?: MemoryChunkRow[];
  files?: FileUploadRow[];
  imports?: FileImportRow[];
}) {
  const activeFiles = filterOriginalBusinessEvidence(files);
  const activeImports = filterOriginalBusinessEvidence(imports).filter((item) => activeFiles.some((file) => file.id === item.file_upload_id));
  const parentEligibility = buildSourceParentEligibility({ files: activeFiles, imports: activeImports });
  const eligibleKpis = filterBySourceParentEligibility(filterOriginalBusinessEvidence(kpis), parentEligibility)
    .filter((row) => Boolean(row.source_file_id || row.import_id) && importedProvenanceIsEligible(row.raw_data_json));
  const eligibleMetrics = filterBySourceParentEligibility(filterOriginalBusinessEvidence(operationalMetrics), parentEligibility)
    .filter((row) => Boolean(row.source_file_id || row.import_id) && importedProvenanceIsEligible(row.raw_data_json));
  const eligibleChunks = filterBySourceParentEligibility(
    filterBusinessEvidence(memoryChunks, { sourceKind: "business_memory" }),
    parentEligibility
  );
  const groups = new Map<string, SourceGroup>();

  const ensureGroup = (sourceKey: string, sourceFileId: string | null, importId: string | null) => {
    if (!groups.has(sourceKey)) {
      groups.set(sourceKey, {
        sourceKey,
        sourceFileId,
        importId,
        kpis: [],
        metrics: [],
        chunks: []
      });
    }
    return groups.get(sourceKey)!;
  };

  for (const row of eligibleKpis) {
    const sourceKey = sourceKeyFor(row);
    if (sourceKey) ensureGroup(sourceKey, row.source_file_id, row.import_id).kpis.push(row);
  }
  for (const row of eligibleMetrics) {
    const sourceKey = sourceKeyFor(row);
    if (sourceKey) ensureGroup(sourceKey, row.source_file_id, row.import_id).metrics.push(row);
  }
  for (const chunk of eligibleChunks) {
    const sourceKey = chunk.source_file_id ? `source-file:${chunk.source_file_id}` : null;
    if (sourceKey && groups.has(sourceKey)) groups.get(sourceKey)!.chunks.push(chunk);
  }

  return Array.from(groups.values())
    .flatMap((group) => candidateDrafts(group).map((draft) => completeCandidate(group, draft)))
    .sort(candidateSort)
    .slice(0, MAX_OPERATIONAL_FINDINGS);
}
