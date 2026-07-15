import { importFileAction, saveExtractedImportAction } from "@/app/app/files/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { WorkbookImportReview } from "@/components/evidence/WorkbookImportReview";
import { KPI_COLOR_PALETTE, kpiColorMayBeLowContrast } from "@/lib/kpis/settings";
import type { Database } from "@/lib/supabase/types";

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type FileImportDataRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type ImportType = "kpi" | "crm" | "metrics";
type JsonRecord = Record<string, unknown>;

const IMPORT_FIELDS: Record<Exclude<ImportType, "crm">, Array<{ key: string; label: string; required?: boolean }>> = {
  kpi: [
    { key: "name", label: "KPI name", required: true },
    { key: "category", label: "Category" },
    { key: "target", label: "Target" },
    { key: "actual_value", label: "Actual value", required: true },
    { key: "metric_date", label: "Date" },
    { key: "owner", label: "Source/context" },
    { key: "notes", label: "Notes" },
    { key: "source", label: "Source" }
  ],
  metrics: [
    { key: "metric_name", label: "Metric name", required: true },
    { key: "category", label: "Category" },
    { key: "value", label: "Value", required: true },
    { key: "metric_date", label: "Date" },
    { key: "owner", label: "Source/context" },
    { key: "notes", label: "Notes" }
  ]
};

const CHART_TYPES = [
  { value: "line", label: "Line chart" },
  { value: "bar", label: "Bar chart" },
  { value: "mixed", label: "Mixed chart" }
];

const VALUE_FORMATS = [
  { value: "", label: "Standard number" },
  { value: "currency", label: "Currency" },
  { value: "percentage", label: "Percentage" },
  { value: "duration", label: "Duration" },
  { value: "count", label: "Count" },
  { value: "decimal", label: "Decimal" }
];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mappingValue(mapping: unknown, key: string) {
  if (!isRecord(mapping)) return "";
  return typeof mapping[key] === "string" ? mapping[key] : "";
}

function interpretationValue(mapping: unknown, key: string, fallback = "") {
  if (!isRecord(mapping) || !isRecord(mapping.kpi_interpretation)) return fallback;
  return typeof mapping.kpi_interpretation[key] === "string" ? mapping.kpi_interpretation[key] : fallback;
}

function rowValues(row: FileImportDataRow) {
  return isRecord(row.data_json) ? row.data_json : {};
}

function rowSource(row: FileImportDataRow) {
  const mapped = isRecord(row.mapped_data_json) ? row.mapped_data_json : {};
  const source = isRecord(mapped.__source) ? mapped.__source : {};
  return {
    worksheet: typeof source.worksheet === "string" && source.worksheet.trim() ? source.worksheet : "Unknown worksheet",
    rowNumber: typeof source.row_number === "number" ? source.row_number : row.row_number
  };
}

function importIssues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((issue) => ({
    stage: typeof issue.stage === "string" ? issue.stage.replace(/_/g, " ") : "import",
    worksheet: typeof issue.worksheet === "string" ? issue.worksheet : "Workbook",
    rowNumber: typeof issue.row_number === "number" ? issue.row_number : null,
    field: typeof issue.field === "string" ? issue.field : "",
    message: typeof issue.message === "string" ? issue.message : "The row could not be processed."
  }));
}

function latestExtraction(file: FileUploadRow) {
  if (!isRecord(file.metadata_json) || !isRecord(file.metadata_json.latest_extraction)) return {};
  return file.metadata_json.latest_extraction;
}

function pipelineTrace(file: FileUploadRow) {
  const extraction = latestExtraction(file);
  if (!Array.isArray(extraction.pipeline_trace)) return [];
  return extraction.pipeline_trace.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      stage: typeof item.stage === "string" ? item.stage.replace(/_/g, " ") : "stage",
      status: typeof item.status === "string" ? item.status.replace(/_/g, " ") : "unknown",
      detail: typeof item.detail === "string" ? item.detail : ""
    }];
  });
}

function worksheetTrace(file: FileUploadRow) {
  const extraction = latestExtraction(file);
  if (!Array.isArray(extraction.worksheets)) return [];
  return extraction.worksheets.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      name: typeof item.name === "string" ? item.name : "Worksheet",
      status: typeof item.status === "string" ? item.status : "unknown",
      rows: typeof item.rows === "number" ? item.rows : 0,
      error: typeof item.error === "string" ? item.error : ""
    }];
  });
}

function ImportDiagnostics({ file, latestImport }: { file: FileUploadRow; latestImport: FileImportRow }) {
  const issues = importIssues(latestImport.errors_json);
  const trace = pipelineTrace(file);
  const worksheets = worksheetTrace(file);
  const parserIssueCount = issues.filter((issue) => issue.stage === "workbook parsing").length;
  const detectionIssueCount = issues.filter((issue) => issue.stage === "worksheet detection").length;
  const extractionIssueCount = issues.filter((issue) => issue.stage === "record extraction").length;
  const validationIssueCount = issues.filter((issue) => issue.stage === "import validation").length;
  const importFailureCount = issues.filter((issue) => issue.stage === "import").length;
  const indexingIssueCount = issues.filter((issue) => issue.stage === "business memory indexing").length;

  if (!issues.length && !trace.length && !worksheets.length) return null;

  return (
    <div className="space-y-3">
      {worksheets.length ? (
        <details className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100">
            Worksheets inspected ({worksheets.length})
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {worksheets.map((worksheet, index) => (
              <div key={`${worksheet.name}-${index}`} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs leading-5">
                <p className="font-semibold text-white">{worksheet.name}</p>
                <p className="capitalize text-slate-400">{worksheet.status.replace(/_/g, " ")} · {worksheet.rows} data row{worksheet.rows === 1 ? "" : "s"}</p>
                {worksheet.error ? <p className="mt-1 text-red-100">{worksheet.error}</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {issues.length ? (
        <details open={latestImport.status === "failed"} className="rounded-lg border border-red-400/25 bg-red-950/15 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-red-100">
            {issues.length} ingestion issue{issues.length === 1 ? "" : "s"}
          </summary>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Workbook parsing: {parserIssueCount} · Worksheet detection: {detectionIssueCount} · Record extraction: {extractionIssueCount} · Row or cell validation: {validationIssueCount} · Import failures: {importFailureCount} · Indexing: {indexingIssueCount}
          </p>
          <ol className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-2 text-xs leading-5 text-slate-300">
            {issues.map((issue, index) => (
              <li key={`${issue.worksheet}-${issue.rowNumber ?? "sheet"}-${issue.stage}-${index}`} className="rounded-md border border-white/10 bg-slate-950/55 p-3">
                <p className="font-semibold text-white">
                  {issue.worksheet}{issue.rowNumber ? ` · row ${issue.rowNumber}` : ""}
                </p>
                <p className="mt-1 text-slate-400">Stage: {issue.stage}{issue.field ? ` · Field: ${issue.field}` : ""}</p>
                <p className="mt-1 text-slate-200">{issue.message}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {trace.length ? (
        <details className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Ingestion pipeline trace</summary>
          <div className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
            {trace.map((item, index) => (
              <div key={`${item.stage}-${index}`} className="grid gap-1 border-t border-white/10 pt-2 sm:grid-cols-[10rem_8rem_minmax(0,1fr)]">
                <span className="font-semibold capitalize text-white">{item.stage}</span>
                <span className="capitalize text-cyan-100">{item.status}</span>
                <span className="text-slate-400">{item.detail}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function asImportType(value: string): ImportType {
  if (value === "crm" || value === "metrics") return value;
  return "kpi";
}

function statusLabel(value: string) {
  if (value === "needs_review" || value === "extracted") return "Needs review";
  if (value === "completed") return "Imported";
  if (value === "failed") return "Failed";
  return value.replace(/_/g, " ") || "Staged";
}

export function SourceImportReview({
  file,
  imports,
  rows
}: {
  file: FileUploadRow;
  imports: FileImportRow[];
  rows: FileImportDataRow[];
}) {
  const latestImport = imports[0];

  if (!latestImport) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-6 text-sm leading-6 text-slate-400">
        <p>No structured import has been prepared from this source.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={importFileAction}>
            <input type="hidden" name="file_id" value={file.id} />
            <input type="hidden" name="import_type" value="metrics" />
            <PendingSubmitButton pendingLabel="Inspecting worksheets..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Prepare workbook import</PendingSubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const importType = asImportType(latestImport.import_type);
  const importRows = rows.filter((row) => row.import_id === latestImport.id).sort((a, b) => a.row_number - b.row_number);
  const needsReview = latestImport.status === "needs_review" || latestImport.status === "extracted";
  const isWorkbookImport = isRecord(latestImport.mapping_json) && latestImport.mapping_json.mode === "workbook";

  if (!needsReview) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-semibold text-white">{statusLabel(latestImport.status)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {latestImport.rows_imported} of {latestImport.rows_total} rows were saved from this source.
          </p>
          {latestImport.extraction_summary ? <p className="mt-2 text-xs leading-5 text-slate-500">{latestImport.extraction_summary}</p> : null}
          {latestImport.status === "failed" || (latestImport.status === "completed" && isWorkbookImport) ? (
            <form action={importFileAction} className="mt-4">
              <input type="hidden" name="file_id" value={file.id} />
              <input type="hidden" name="import_type" value={importType === "metrics" ? "metrics" : "kpi"} />
              <PendingSubmitButton pendingLabel="Re-reading every worksheet..." className="min-h-10 rounded-md bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                {isWorkbookImport ? "Re-prepare workbook" : "Re-prepare import"}
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
        <ImportDiagnostics file={file} latestImport={latestImport} />
      </div>
    );
  }

  if (importType === "crm") {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4 text-sm leading-6 text-amber-50">
        <p className="font-semibold">Customer record imports are retired.</p>
        <p className="mt-2 text-amber-100/85">This historical staged import remains visible for audit context, but it cannot create Vaeroex-owned customer records.</p>
      </div>
    );
  }

  if (!importRows.length) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4 text-sm leading-6 text-amber-50">
        No extracted rows are available. Prepare the import again before approving data.
      </div>
    );
  }

  if (isRecord(latestImport.mapping_json) && latestImport.mapping_json.mode === "workbook") {
    return (
      <div className="space-y-4">
        <ImportDiagnostics file={file} latestImport={latestImport} />
        <WorkbookImportReview file={file} importRecord={latestImport} rows={importRows} />
      </div>
    );
  }

  const fields = IMPORT_FIELDS[importType];
  const columns = Array.from(new Set(importRows.flatMap((row) => Object.keys(rowValues(row))))).filter(Boolean);
  const previewRows = importRows.slice(0, 5);
  const color = interpretationValue(latestImport.mapping_json, "color", "#10B981");
  const inputClass = "mt-2 min-h-11 w-full rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-vaeroex-accent";

  return (
    <form action={saveExtractedImportAction} className="space-y-5">
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="import_id" value={latestImport.id} />
      <input type="hidden" name="import_type" value={importType} />

      <div className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4">
        <p className="text-sm font-semibold text-white">Review imported data</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">
          Vaeroex found {latestImport.rows_total} row{latestImport.rows_total === 1 ? "" : "s"}. Nothing is added to active KPI or metric history until you approve the mappings below.
        </p>
      </div>

      <ImportDiagnostics file={file} latestImport={latestImport} />

      {importType === "kpi" ? (
        <details className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100">KPI display settings</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-sm text-slate-300">Unit/type<input name="unit_type" defaultValue={interpretationValue(latestImport.mapping_json, "unit_type")} className={inputClass} /></label>
            <label className="text-sm text-slate-300">Display unit<input name="display_unit" defaultValue={interpretationValue(latestImport.mapping_json, "display_unit")} className={inputClass} /></label>
            <label className="text-sm text-slate-300">Value format<select name="value_format" defaultValue={interpretationValue(latestImport.mapping_json, "value_format")} className={inputClass}>{VALUE_FORMATS.map((option) => <option key={option.value || "standard"} value={option.value}>{option.label}</option>)}</select></label>
            <label className="text-sm text-slate-300">X-axis label<input name="x_axis_label" defaultValue={interpretationValue(latestImport.mapping_json, "x_axis_label", "Date")} className={inputClass} /></label>
            <label className="text-sm text-slate-300">Y-axis label<input name="y_axis_label" defaultValue={interpretationValue(latestImport.mapping_json, "y_axis_label")} className={inputClass} /></label>
            <label className="text-sm text-slate-300">Preferred chart<select name="preferred_chart_type" defaultValue={interpretationValue(latestImport.mapping_json, "preferred_chart_type", "line")} className={inputClass}>{CHART_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="text-sm text-slate-300">KPI color<select name="color" defaultValue={color} className={inputClass}>{KPI_COLOR_PALETTE.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.value})</option>)}</select></label>
          </div>
          {kpiColorMayBeLowContrast(color) ? <p className="mt-3 text-xs leading-5 text-amber-100">This color may have low contrast on dark charts. Review it before saving.</p> : null}
        </details>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
        <h3 className="text-sm font-semibold text-white">Column mapping</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="text-sm text-slate-300">
              {field.label}{field.required ? <span className="text-red-300"> *</span> : null}
              <select name={`map_${field.key}`} defaultValue={mappingValue(latestImport.mapping_json, field.key)} className={inputClass}>
                <option value="">Do not import</option>
                {columns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/45">
        <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Sample rows</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-slate-300">
            <thead className="bg-white/[0.04] text-slate-400"><tr><th className="px-3 py-2">Worksheet</th><th className="px-3 py-2">Row</th>{columns.slice(0, 6).map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead>
            <tbody>{previewRows.map((row) => { const values = rowValues(row); const source = rowSource(row); return <tr key={row.id} className="border-t border-white/10"><td className="whitespace-nowrap px-3 py-2 font-medium text-white">{source.worksheet}</td><td className="px-3 py-2 font-medium">{source.rowNumber}</td>{columns.slice(0, 6).map((column) => <td key={column} className="max-w-48 truncate px-3 py-2">{String(values[column] ?? "")}</td>)}</tr>; })}</tbody>
          </table>
        </div>
      </section>

      <PendingSubmitButton pendingLabel="Saving approved data..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
        Save approved data
      </PendingSubmitButton>
    </form>
  );
}
