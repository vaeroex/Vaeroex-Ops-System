import { importFileAction, saveExtractedImportAction } from "@/app/app/files/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
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
            <input type="hidden" name="import_type" value="kpi" />
            <PendingSubmitButton pendingLabel="Preparing KPI import..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Prepare KPI import</PendingSubmitButton>
          </form>
          <form action={importFileAction}>
            <input type="hidden" name="file_id" value={file.id} />
            <input type="hidden" name="import_type" value="metrics" />
            <PendingSubmitButton pendingLabel="Preparing metric import..." className="min-h-11 rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 disabled:opacity-60">Prepare metric import</PendingSubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const importType = asImportType(latestImport.import_type);
  const importRows = rows.filter((row) => row.import_id === latestImport.id).sort((a, b) => a.row_number - b.row_number);
  const needsReview = latestImport.status === "needs_review" || latestImport.status === "extracted";

  if (!needsReview) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
        <p className="text-sm font-semibold text-white">{statusLabel(latestImport.status)}</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {latestImport.rows_imported} of {latestImport.rows_total} rows were saved from this source.
        </p>
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
            <thead className="bg-white/[0.04] text-slate-400"><tr><th className="px-3 py-2">Row</th>{columns.slice(0, 6).map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead>
            <tbody>{previewRows.map((row) => { const values = rowValues(row); return <tr key={row.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium">{row.row_number}</td>{columns.slice(0, 6).map((column) => <td key={column} className="max-w-48 truncate px-3 py-2">{String(values[column] ?? "")}</td>)}</tr>; })}</tbody>
          </table>
        </div>
      </section>

      <PendingSubmitButton pendingLabel="Saving approved data..." className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
        Save approved data
      </PendingSubmitButton>
    </form>
  );
}
