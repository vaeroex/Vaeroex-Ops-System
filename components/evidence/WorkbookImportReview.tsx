"use client";

import { useMemo, useState } from "react";
import { saveExtractedImportAction } from "@/app/app/files/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import {
  WORKSHEET_IMPORT_FIELDS,
  WORKSHEET_TYPE_OPTIONS,
  inferWorksheetMapping,
  inferWideTimeSeriesMetricColumns,
  isWorksheetType,
  worksheetTypeLabel,
  type WorksheetMapping,
  type WorksheetType
} from "@/lib/imports/worksheet-types";
import type { Database } from "@/lib/supabase/types";

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type FileImportDataRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type JsonRecord = Record<string, unknown>;

type WorksheetPlan = {
  index: number;
  name: string;
  status: string;
  row_count: number;
  columns: string[];
  detected_type: WorksheetType;
  selected_type: WorksheetType;
  enabled: boolean;
  mapping: WorksheetMapping;
  metric_columns: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePlans(value: unknown): WorksheetPlan[] {
  if (!isRecord(value) || value.mode !== "workbook" || !Array.isArray(value.worksheets)) return [];

  return value.worksheets.flatMap((item) => {
    if (!isRecord(item)) return [];
    const index = Number(item.index);
    const type = typeof item.selected_type === "string" && isWorksheetType(item.selected_type)
      ? item.selected_type
      : typeof item.detected_type === "string" && isWorksheetType(item.detected_type)
        ? item.detected_type
        : "unknown";
    const columns = Array.isArray(item.columns) ? item.columns.filter((column): column is string => typeof column === "string") : [];
    const mapping = isRecord(item.mapping)
      ? Object.fromEntries(Object.entries(item.mapping).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : inferWorksheetMapping(type, columns);
    const metricColumns = Array.isArray(item.metric_columns)
      ? item.metric_columns.filter((column): column is string => typeof column === "string" && columns.includes(column))
      : type === "wide_time_series"
        ? inferWideTimeSeriesMetricColumns({ columns }, mapping.period)
        : [];

    if (!Number.isInteger(index) || typeof item.name !== "string") return [];
    return [{
      index,
      name: item.name,
      status: typeof item.status === "string" ? item.status : "parsed",
      row_count: typeof item.row_count === "number" ? item.row_count : 0,
      columns,
      detected_type: typeof item.detected_type === "string" && isWorksheetType(item.detected_type) ? item.detected_type : type,
      selected_type: type,
      enabled: item.enabled === true,
      mapping,
      metric_columns: metricColumns
    }];
  });
}

function rowSource(row: FileImportDataRow) {
  const mapped = isRecord(row.mapped_data_json) ? row.mapped_data_json : {};
  const source = isRecord(mapped.__source) ? mapped.__source : {};
  return {
    worksheetIndex: Number(source.worksheet_index),
    rowNumber: Number(source.row_number) || row.row_number
  };
}

function rowValues(row: FileImportDataRow) {
  return isRecord(row.data_json) ? row.data_json : {};
}

export function WorkbookImportReview({
  file,
  importRecord,
  rows
}: {
  file: FileUploadRow;
  importRecord: FileImportRow;
  rows: FileImportDataRow[];
}) {
  const [plans, setPlans] = useState(() => parsePlans(importRecord.mapping_json));
  const enabledCount = plans.filter((plan) => plan.enabled).length;
  const inputClass = "mt-2 min-h-11 w-full rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-vaeroex-accent disabled:opacity-50";
  const rowsByWorksheet = useMemo(() => {
    const result = new Map<number, FileImportDataRow[]>();
    for (const row of rows) {
      const index = rowSource(row).worksheetIndex;
      result.set(index, [...(result.get(index) || []), row]);
    }
    return result;
  }, [rows]);

  function updatePlan(index: number, update: Partial<WorksheetPlan>) {
    setPlans((current) => current.map((plan) => plan.index === index ? { ...plan, ...update } : plan));
  }

  function changeType(plan: WorksheetPlan, value: string) {
    if (!isWorksheetType(value)) return;
    const mapping = inferWorksheetMapping(value, plan.columns);
    updatePlan(plan.index, {
      selected_type: value,
      mapping,
      metric_columns: value === "wide_time_series"
        ? inferWideTimeSeriesMetricColumns({ columns: plan.columns }, mapping.period)
        : [],
      enabled: value !== "unknown" || plan.enabled
    });
  }

  return (
    <form action={saveExtractedImportAction} className="space-y-5">
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="import_id" value={importRecord.id} />
      <input type="hidden" name="import_type" value="metrics" />
      <input type="hidden" name="workbook_mode" value="true" />

      <div className="rounded-lg border border-amber-300/25 bg-amber-950/15 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-100/80">Workbook</p>
        <p className="mt-1 break-words text-sm font-semibold text-white">{file.display_name}</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">
          Vaeroex inspected each worksheet independently. Confirm the detected context and mapping for each dataset you want to import.
        </p>
      </div>

      <div className="space-y-3">
        {plans.map((plan) => {
          const fields = WORKSHEET_IMPORT_FIELDS[plan.selected_type];
          const samples = (rowsByWorksheet.get(plan.index) || []).slice(0, 3);
          const canImport = plan.status === "parsed" && plan.row_count > 0;

          return (
            <details key={plan.index} className="rounded-lg border border-white/10 bg-slate-950/45" open={plans.length <= 3}>
              <summary className="cursor-pointer list-none px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{plan.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Detected: {worksheetTypeLabel(plan.detected_type)} · {plan.row_count} row{plan.row_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-200" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      name={`worksheet_${plan.index}_enabled`}
                      checked={plan.enabled && canImport}
                      disabled={!canImport}
                      onChange={(event) => updatePlan(plan.index, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-cyan-400"
                    />
                    Import worksheet
                  </label>
                </div>
              </summary>

              <div className="space-y-4 border-t border-white/10 px-4 py-4">
                {!canImport ? (
                  <p className="rounded-md border border-amber-300/20 bg-amber-950/20 p-3 text-sm text-amber-100">
                    This worksheet has no supported data rows and will not be imported.
                  </p>
                ) : null}

                <label className="block text-sm text-slate-300">
                  Dataset type
                  <select
                    name={`worksheet_${plan.index}_type`}
                    value={plan.selected_type}
                    disabled={!canImport}
                    onChange={(event) => changeType(plan, event.target.value)}
                    className={inputClass}
                  >
                    {WORKSHEET_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>

                {fields.length ? (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{worksheetTypeLabel(plan.selected_type)} mapping</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {fields.map((field) => (
                        <label key={field.key} className="text-sm text-slate-300">
                          {field.label}{field.required ? <span className="text-red-300"> *</span> : null}
                          <select
                            name={`worksheet_${plan.index}_map_${field.key}`}
                            value={plan.mapping[field.key] || ""}
                            disabled={!plan.enabled || !canImport}
                            onChange={(event) => {
                              const mapping = { ...plan.mapping, [field.key]: event.target.value };
                              updatePlan(plan.index, {
                                mapping,
                                metric_columns: plan.selected_type === "wide_time_series" && field.key === "period"
                                  ? inferWideTimeSeriesMetricColumns({ columns: plan.columns }, mapping.period)
                                  : plan.metric_columns
                              });
                            }}
                            className={inputClass}
                          >
                            <option value="">Do not import</option>
                            {plan.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-slate-400">
                    This worksheet will be preserved as source evidence and organizational context. It will not create structured KPI or metric records.
                  </p>
                )}

                {plan.selected_type === "wide_time_series" ? (
                  <div className="rounded-md border border-cyan-300/15 bg-cyan-950/15 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Metric series</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Each valid numeric cell becomes a dated metric. Invalid cells are reported individually without rejecting other metrics in that row.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {plan.metric_columns.map((column) => (
                        <span key={column} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200">{column}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {samples.length ? (
                  <div className="overflow-x-auto rounded-md border border-white/10">
                    <table className="min-w-full text-left text-xs text-slate-300">
                      <thead className="bg-white/[0.04] text-slate-400">
                        <tr><th className="px-3 py-2">Row</th>{plan.columns.slice(0, 6).map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {samples.map((row) => {
                          const values = rowValues(row);
                          return (
                            <tr key={row.id} className="border-t border-white/10">
                              <td className="px-3 py-2 font-medium text-white">{rowSource(row).rowNumber}</td>
                              {plan.columns.slice(0, 6).map((column) => <td key={column} className="max-w-48 truncate px-3 py-2">{String(values[column] ?? "")}</td>)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PendingSubmitButton
          pendingLabel="Importing approved worksheets..."
          disabled={enabledCount === 0}
          className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Import {enabledCount} approved worksheet{enabledCount === 1 ? "" : "s"}
        </PendingSubmitButton>
        <p className="text-xs text-slate-500">Only approved worksheets are validated and imported.</p>
      </div>
    </form>
  );
}
