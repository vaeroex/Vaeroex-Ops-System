import { z } from "zod";
import { daySchema, instantSchema } from "./contracts";

/** Application-issued metadata aligned one-to-one with immutable fact indices.
 * A document/row date is not an observation timestamp, import time or proof of
 * comparable periods. Unknown timing is deliberately not filled from retrieval. */
export const factTimeSchema = z.object({
  date: daySchema.nullable(),
  basis: z.enum(["invoice_or_bill_date", "sheet_row_date", "spent_date", "entry_start_utc_date",
    "posting_date", "report_period", "payment_instant", "receipt_instant", "order_instant",
    "invoice_or_expense_date", "snapshot_capture", "lifetime_project_snapshot"]),
  valueTiming: z.enum(["document_contribution", "balance_at_import", "row_value", "entry_contribution",
    "stored_report_value", "payment_record", "receipt_record", "order_record", "snapshot_at_capture", "lifetime_through_capture"]),
  periodEnd: daySchema.optional(),
  instant: instantSchema.optional(),
  endInstant: instantSchema.optional(),
  // Capture/import metadata is deliberately distinct from the fact's business
  // date/period and never establishes a historical balance as-of time.
  recordObservedAt: instantSchema.nullable().optional(),
  recordSynchronizedAt: instantSchema.nullable().optional(),
  connectionLastSyncAt: instantSchema.nullable().optional(),
  timeZone: z.string().min(1).max(80).refine(value => { try { new Intl.DateTimeFormat('en', {timeZone:value}); return true; } catch { return false; } }).optional()

}).strict();
export type FactTime = z.infer<typeof factTimeSchema>;
export type FactTimeGroup = FactTime & { factIndexes: number[] };
const groupSchema = factTimeSchema.extend({factIndexes:z.array(z.number().int().nonnegative()).min(1)}).strict();
function checkTime(time: FactTime): FactTime {
  const timings: Record<FactTime['basis'], readonly FactTime['valueTiming'][]> = {
    invoice_or_bill_date:['document_contribution','balance_at_import'],sheet_row_date:['row_value'],spent_date:['entry_contribution'],entry_start_utc_date:['entry_contribution'],
    posting_date:['document_contribution','balance_at_import'],report_period:['stored_report_value'],payment_instant:['payment_record'],receipt_instant:['receipt_record'],order_instant:['order_record'],
    invoice_or_expense_date:['document_contribution','balance_at_import'],snapshot_capture:['snapshot_at_capture'],lifetime_project_snapshot:['lifetime_through_capture']
  };
  const event=['payment_instant','receipt_instant','order_instant'].includes(time.basis),snapshot=['snapshot_capture','lifetime_project_snapshot'].includes(time.basis);
  if (!timings[time.basis].includes(time.valueTiming)
    || ('recordObservedAt' in time || 'recordSynchronizedAt' in time) && !['posting_date','report_period'].includes(time.basis)
    || 'connectionLastSyncAt' in time && time.basis!=='sheet_row_date'
    || time.periodEnd && (!time.date || time.periodEnd < time.date)
    || time.endInstant && (!time.instant || Date.parse(time.endInstant) < Date.parse(time.instant))
    || !['posting_date','lifetime_project_snapshot'].includes(time.basis) && !time.date
    || time.basis === 'report_period' && (!time.date || !time.periodEnd)
    || event && (!time.instant || !time.timeZone || time.periodEnd || time.endInstant)
    || snapshot && (!time.instant || !time.endInstant || time.timeZone!=='UTC')
    || time.basis === 'snapshot_capture' && !time.periodEnd
    || time.basis === 'lifetime_project_snapshot' && (time.date !== null || time.periodEnd)
    || !event && !snapshot && (time.instant || time.endInstant || time.timeZone)
    || time.periodEnd && !['report_period','snapshot_capture'].includes(time.basis)) throw new Error('fact_time_semantics_invalid');
  if(event||time.basis==='snapshot_capture'){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:time.timeZone!,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time.instant!));
    const date=['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
    if(date!==time.date||time.basis==='snapshot_capture'&&new Date(time.endInstant!).toISOString().slice(0,10)!==time.periodEnd)throw new Error('fact_time_semantics_invalid');
  }
  return time;
}
/** Lossless grouping avoids repeating identical date semantics for every metric. */
export function groupFactTimes(times: readonly FactTime[]): FactTimeGroup[] {
  const groups=new Map<string,FactTimeGroup>();
  times.forEach((input,index)=>{const time=checkTime(factTimeSchema.parse(input));const key=JSON.stringify(time),group=groups.get(key);if(group)group.factIndexes.push(index);else groups.set(key,{...time,factIndexes:[index]});});
  return [...groups.values()];
}
export function expandFactTimes(raw: readonly FactTimeGroup[], count: number): FactTime[] {
  const output:FactTime[]=[];
  for(const group of raw){const {factIndexes,...time}=groupSchema.parse(group);for(const index of factIndexes){
    if(index>=count||output[index])throw new Error('fact_time_index_alignment');output[index]=checkTime(time);
  }}
  if(output.length!==count||Array.from({length:count},(_,index)=>output[index]).some(time=>!time))throw new Error('fact_time_index_alignment');
  return output;
}

const basisLabels: Record<FactTime["basis"], string> = {
  invoice_or_bill_date: "invoice/bill date", sheet_row_date: "supplied row date",
  spent_date: "entry spent date", entry_start_utc_date: "entry start date (UTC)",
  posting_date: "document posting date", report_period: "stored report period",
  payment_instant: "payment created date", receipt_instant: "receipt date", order_instant: "order created date",
  invoice_or_expense_date: "invoice/expense date", snapshot_capture: "snapshot capture date",
  lifetime_project_snapshot: "lifetime project measure, beginning unknown"
};

/** Selected facts only. Never infer dates from prose or an enclosing query range.
 * This is an evidence limitation, not semantic validation of model draft text. */
export function selectedFactTimeLines(rows: readonly { ref: string; time: FactTime | null }[]): string[] {
  if (!rows.length) return [];
  const byRef = new Map<string, Array<FactTime | null>>();
  for (const row of rows) byRef.set(row.ref, [...(byRef.get(row.ref) || []), row.time]);
  const lines = [...byRef].map(([ref, times]) => {
    const known = times.filter((time): time is FactTime => time !== null);
    const labels = [...new Set(known.map(time => `${basisLabels[time.basis]} ${time.date ?? '(business period unknown)'}${time.periodEnd ? ` through ${time.periodEnd}` : ''}${time.instant ? `; captured/event instant ${time.instant}${time.endInstant ? ` through ${time.endInstant}` : ''}${time.timeZone ? ` (${time.timeZone})` : ''}` : ''}`))];
    const unknown = known.length < times.length || known.some(time => time.date === null) ? " Some selected facts have no known business date or period." : "";
    const capture = [...new Set(known.flatMap(time => [
      ...('recordObservedAt' in time ? [`source record observation time ${time.recordObservedAt ?? 'unknown'}`] : []),
      ...('recordSynchronizedAt' in time ? [`source record synchronization time ${time.recordSynchronizedAt ?? 'unknown'}`] : []),
      ...('connectionLastSyncAt' in time ? [`connection last successful sync ${time.connectionLastSyncAt ?? 'unknown'}`] : [])
    ]))];
    const captureLine = capture.length ? ` Import metadata: ${capture.join('; ')}. These timestamps do not replace the business date or establish measurement alignment.` : '';
    const balance = known.some(time => time.valueTiming === "balance_at_import")
      ? " Outstanding values are balances at import; historical balance as-of time is not established by document dates or capture/sync timestamps." : "";
    return `Selected fact dates: ${labels.join("; ") || "not established"}.${unknown}${captureLine}${balance} [${ref}]`;
  });
  if (byRef.size > 1) {
    const signatures = [...byRef.values()].map(times => JSON.stringify([...new Set(times.filter((time): time is FactTime => time !== null).map(time => `${time.date ?? "unknown"}/${time.periodEnd ?? time.date ?? "unknown"}`))].sort()));
    const unknown = rows.some(row => row.time === null || row.time.date === null);
    const comparison = unknown
      ? "some selected date semantics are unknown; date-label comparison is incomplete and same-period alignment is not established."
      : new Set(signatures).size > 1
        ? "selected date labels differ; same-period alignment is not established."
        : "matching date labels alone do not establish comparable measurement times.";
    lines.push(`Application date check: ${comparison} Retrieval-window overlap does not establish date alignment or record correspondence. ${[...byRef.keys()].map(ref => `[${ref}]`).join(" ")}`);
  }
  return lines;
}
