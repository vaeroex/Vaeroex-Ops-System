"use client";

import { useId, useRef, useState } from "react";
import { FieldMappingSchema, sheetColumn, type FieldMapping } from "@/lib/integrations/google-sheets/contracts";

const inputClass = "mt-1 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50";

type Preview = { headers: string[]; rows: string[][]; sampleSize: number; truncated: boolean };

function initialMapping(headers: string[]): FieldMapping {
  const available = headers.flatMap((label, index) => label && label !== "[restricted column]" ? [index] : []);
  const dateColumn = available.find((index) => /date|period/i.test(headers[index])) ?? available[0] ?? 0;
  const rowKeyColumn = available.find((index) => index !== dateColumn && /(^id$|key|record.?id|reference)/i.test(headers[index])) ?? available.find((index) => index !== dateColumn) ?? 0;
  const metricColumn = available.find((index) => index !== dateColumn && index !== rowKeyColumn);
  return {
    dateColumn, dateFormat: "iso", rowKeyColumn, locationColumn: null,
    metrics: metricColumn === undefined ? [] : [{ column: metricColumn, name: headers[metricColumn].slice(0, 80), unit: "number", category: "Google Sheets", target: null }]
  };
}

function ColumnSelect({ label, value, headers, optional, onChange }: {
  label: string; value: number | null; headers: string[]; optional?: boolean; onChange: (value: number | null) => void;
}) {
  return <label className="block min-w-0 text-sm font-medium text-ink">{label}
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} required={!optional} className={inputClass}>
      {optional ? <option value="">None</option> : null}
      {headers.map((header, index) => header && header !== "[restricted column]" ? <option key={index} value={index}>{sheetColumn(index)} · {header}</option> : null)}
    </select>
  </label>;
}

export function GoogleSheetsMappingEditor({ connectionId, headers, savedMapping, automaticEnabled, approved }: {
  connectionId: string; headers: string[]; savedMapping: FieldMapping | null; automaticEnabled: boolean; approved: boolean;
}) {
  const descriptionId = useId();
  const mappingRevision = useRef(0);
  const [mapping, setMapping] = useState<FieldMapping>(() => savedMapping ?? initialMapping(headers));
  const [automatic, setAutomatic] = useState(automaticEnabled);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const validMapping = FieldMappingSchema.safeParse(mapping);
  const usedColumns = new Set([mapping.rowKeyColumn, mapping.dateColumn, mapping.locationColumn, ...mapping.metrics.map((metric) => metric.column)]);
  const nextMetricColumn = headers.findIndex((header, index) => header && header !== "[restricted column]" && !usedColumns.has(index));

  function updateMapping(next: FieldMapping) {
    mappingRevision.current += 1;
    setMapping(next);
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
  }

  function updateMetric(index: number, change: Partial<FieldMapping["metrics"][number]>) {
    updateMapping({ ...mapping, metrics: mapping.metrics.map((metric, position) => position === index ? { ...metric, ...change } : metric) });
  }

  async function previewColumns() {
    if (!validMapping.success) return;
    const revision = mappingRevision.current;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const response = await fetch("/api/integrations/google-sheets/preview", {
        method: "POST", credentials: "same-origin",
        body: new URLSearchParams({ connectionId, fieldMapping: JSON.stringify(validMapping.data) }),
        signal: AbortSignal.timeout(30_000)
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("ok" in result) || result.ok !== true ||
        !("headers" in result) || !Array.isArray(result.headers) || !result.headers.every((item) => typeof item === "string") ||
        !("rows" in result) || !Array.isArray(result.rows) || !result.rows.every((row) => Array.isArray(row) && row.every((item) => typeof item === "string"))) {
        throw new Error("preview_unavailable");
      }
      if (revision !== mappingRevision.current) return;
      setPreview({ headers: result.headers, rows: result.rows, sampleSize: result.rows.length, truncated: "truncated" in result && result.truncated === true });
    } catch {
      if (revision === mappingRevision.current) setPreviewError("Preview could not be loaded. Check the connection, selected columns, and spreadsheet access, then try again. No mapping was saved.");
    } finally {
      setPreviewing(false);
    }
  }

  return <form action="/api/integrations/google-sheets/mapping" method="post" className="space-y-5" onSubmit={() => setSaving(true)} aria-describedby={descriptionId}>
    <input type="hidden" name="connectionId" value={connectionId} />
    <input type="hidden" name="fieldMapping" value={JSON.stringify(mapping)} />
    <input type="hidden" name="automaticRefresh" value={String(automatic)} />
    <div>
      <h4 className="text-base font-semibold text-ink">Map and review your business metrics</h4>
      <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600">Choose a stable, unique business record ID and a date for each row. Keep the same IDs when editing or moving rows so future refreshes update the same records. Use a separate column for each numeric metric and one row per date and location. Repeated metric/date combinations are held for review.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <ColumnSelect label="Unique row ID" value={mapping.rowKeyColumn} headers={headers} onChange={(value) => updateMapping({ ...mapping, rowKeyColumn: value ?? 0 })} />
      <ColumnSelect label="Date column" value={mapping.dateColumn} headers={headers} onChange={(value) => updateMapping({ ...mapping, dateColumn: value ?? 0 })} />
      <label className="block text-sm font-medium text-ink">Date format
        <select value={mapping.dateFormat} onChange={(event) => updateMapping({ ...mapping, dateFormat: event.target.value as FieldMapping["dateFormat"] })} className={inputClass}>
          <option value="iso">Text dates: YYYY-MM-DD</option>
          <option value="serial">Google Sheets date cells</option>
        </select>
      </label>
      <ColumnSelect label="Location column (optional)" value={mapping.locationColumn} headers={headers} optional onChange={(value) => updateMapping({ ...mapping, locationColumn: value })} />
    </div>
    <p className="text-xs leading-5 text-slate-600">For date-formatted Google Sheets cells, choose “Google Sheets date cells.” Locations keep metrics separate within the connection’s business entity. Use business identifiers only, such as store codes.</p>
    <div className="space-y-3">
      {mapping.metrics.map((metric, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-md border border-line p-3 sm:p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Metric {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ColumnSelect label="Numeric column" value={metric.column} headers={headers} onChange={(value) => updateMetric(index, { column: value ?? 0 })} />
          <label className="block min-w-0 text-sm font-medium text-ink">Metric name
            <input value={metric.name} onChange={(event) => updateMetric(index, { name: event.target.value })} required maxLength={80} className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-ink">Unit
            <select value={metric.unit} onChange={(event) => updateMetric(index, { unit: event.target.value as FieldMapping["metrics"][number]["unit"] })} className={inputClass}>
              <option value="number">Number</option><option value="count">Count</option><option value="percent">Percent points (25 = 25%)</option><option value="percent_fraction">Sheet percent cells (0.25 = 25%)</option><option value="currency">Currency</option>
            </select>
          </label>
          <label className="block min-w-0 text-sm font-medium text-ink">Category
            <input value={metric.category} onChange={(event) => updateMetric(index, { category: event.target.value })} required maxLength={80} className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-ink">Target (optional)
            <input type="number" step="any" min={-1e15} max={1e15} value={metric.target ?? ""} onChange={(event) => updateMetric(index, { target: event.target.value === "" ? null : Number(event.target.value) })} className={inputClass} />
            {metric.unit === "percent_fraction" ? <span className="mt-1 block text-xs font-normal leading-5 text-slate-600">Enter the target in percentage points: 25 means 25%.</span> : null}
          </label>
          <button type="button" onClick={() => updateMapping({ ...mapping, metrics: mapping.metrics.filter((_, position) => position !== index) })} className={`${buttonClass} self-end`} aria-label={`Remove metric ${index + 1}`}>Remove metric</button>
        </div>
      </fieldset>)}
      <button type="button" disabled={mapping.metrics.length >= 12 || nextMetricColumn < 0} className={buttonClass} onClick={() => {
        const column = nextMetricColumn;
        if (column >= 0) updateMapping({ ...mapping, metrics: [...mapping.metrics, { column, name: headers[column].slice(0, 80), category: "Google Sheets", unit: "number", target: null }] });
      }}>Add numeric metric ({mapping.metrics.length}/12)</button>
      <p className="text-xs leading-5 text-slate-600">Choose units that match the sheet’s values. Targets and metric names should match your business definition. Preview the selected cells before approving.</p>
    </div>
    {!validMapping.success ? <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Choose different columns for the row ID, date, location, and each metric. Add at least one metric, use unique metric names, and complete every required field.</p> : null}
    <div className="space-y-3">
      <button type="button" onClick={previewColumns} disabled={!validMapping.success || previewing} className={buttonClass}>{previewing ? "Loading preview…" : "Preview selected columns"}</button>
      <div aria-live="polite">
        {previewError ? <p role="alert" className="text-sm text-red-700">{previewError}</p> : null}
        {preview ? <div className="space-y-2">
          <p className="text-sm text-slate-600">Preview of {preview.sampleSize} rows. {preview.truncated ? "More rows will be checked during sync." : "All returned preview rows are shown."} Preview does not import data.</p>
          <div className="max-w-full overflow-x-auto rounded-md border border-line" tabIndex={0} role="region" aria-label="Spreadsheet preview; scroll horizontally for more columns">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Sample values from selected spreadsheet columns</caption>
              <thead className="bg-slate-50"><tr>{preview.headers.map((header, index) => <th scope="col" key={index} className="whitespace-nowrap border-b border-line px-3 py-2 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.headers.map((_, columnIndex) => <td key={columnIndex} className="max-w-64 break-words border-b border-line px-3 py-2">{row[columnIndex] || "—"}</td>)}</tr>)}</tbody>
            </table>
            {!preview.rows.length ? <p className="p-3 text-sm text-slate-600">No data rows were found below the header.</p> : null}
          </div>
        </div> : null}
      </div>
    </div>
    <div className="space-y-3 border-t border-line pt-4">
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-ink">
        <input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} className="mt-1.5 h-4 w-4 shrink-0" />
        <span><span className="font-semibold">Refresh every 15 minutes</span><br /><span className="text-slate-600">Check this spreadsheet every 15 minutes using this approved mapping. You can also use Sync now. Failed refreshes retry with a delay.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm leading-6 text-ink">
        <input type="checkbox" name="confirmation" value="approve" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required className="mt-1.5 h-4 w-4 shrink-0" />
        <span>I confirm these columns contain business data only and approve this spreadsheet and mapping as a source for these metrics. Validated values may update Executive Intelligence. Invalid or conflicting values must be held for review.</span>
      </label>
      <p className="text-xs leading-5 text-slate-600">{approved ? "Saving confirms the mapping and refresh preference again. Changed mappings require a new approval." : "Nothing flows into Executive Intelligence until you approve the mapping and run a successful sync."}</p>
      <button type="submit" disabled={!validMapping.success || !confirmed || saving} className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Approve and save mapping"}</button>
    </div>
  </form>;
}
