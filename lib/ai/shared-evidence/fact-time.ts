import { z } from "zod";
import { daySchema } from "./contracts";

/** Application-issued metadata aligned one-to-one with immutable fact indices.
 * A document/row date is not an observation timestamp, import time or proof of
 * comparable periods. Unknown timing is deliberately not filled from retrieval. */
export const factTimeSchema = z.object({
  date: daySchema,
  basis: z.enum(["invoice_or_bill_date", "sheet_row_date", "spent_date", "entry_start_utc_date"]),
  valueTiming: z.enum(["document_contribution", "balance_at_import", "row_value", "entry_contribution"])
}).strict();
export type FactTime = z.infer<typeof factTimeSchema>;
export type FactTimeGroup = FactTime & { factIndexes: number[] };
const groupSchema = factTimeSchema.extend({factIndexes:z.array(z.number().int().nonnegative()).min(1)}).strict();
/** Lossless grouping avoids repeating identical date semantics for every metric. */
export function groupFactTimes(times: readonly FactTime[]): FactTimeGroup[] {
  const groups=new Map<string,FactTimeGroup>();
  times.forEach((time,index)=>{const key=JSON.stringify(time),group=groups.get(key);if(group)group.factIndexes.push(index);else groups.set(key,{...time,factIndexes:[index]});});
  return [...groups.values()];
}
export function expandFactTimes(raw: readonly FactTimeGroup[], count: number): FactTime[] {
  const output:FactTime[]=[];
  for(const group of raw){const {factIndexes,...time}=groupSchema.parse(group);for(const index of factIndexes){
    if(index>=count||output[index])throw new Error('fact_time_index_alignment');output[index]=time;
  }}
  if(output.length!==count||Array.from({length:count},(_,index)=>output[index]).some(time=>!time))throw new Error('fact_time_index_alignment');
  return output;
}

const basisLabels: Record<FactTime["basis"], string> = {
  invoice_or_bill_date: "invoice/bill date", sheet_row_date: "supplied row date",
  spent_date: "entry spent date", entry_start_utc_date: "entry start date (UTC)"
};

/** Selected facts only. Never infer dates from prose or an enclosing query range.
 * This is an evidence limitation, not semantic validation of model draft text. */
export function selectedFactTimeLines(rows: readonly { ref: string; time: FactTime | null }[]): string[] {
  if (!rows.length) return [];
  const byRef = new Map<string, Array<FactTime | null>>();
  for (const row of rows) byRef.set(row.ref, [...(byRef.get(row.ref) || []), row.time]);
  const lines = [...byRef].map(([ref, times]) => {
    const known = times.filter((time): time is FactTime => time !== null);
    const labels = [...new Set(known.map(time => `${basisLabels[time.basis]} ${time.date}`))];
    const unknown = known.length < times.length ? " Some selected facts have no typed date semantics." : "";
    const balance = known.some(time => time.valueTiming === "balance_at_import")
      ? " Outstanding values are balances at import; their exact observation time is unavailable here, not the document date." : "";
    return `Selected fact dates: ${labels.join("; ") || "not established"}.${unknown}${balance} [${ref}]`;
  });
  if (byRef.size > 1) {
    const signatures = [...byRef.values()].map(times => JSON.stringify([...new Set(times.filter((time): time is FactTime => time !== null).map(time => time.date))].sort()));
    const unknown = rows.some(row => row.time === null);
    const comparison = unknown
      ? "some selected date semantics are unknown; date-label comparison is incomplete and same-period alignment is not established."
      : new Set(signatures).size > 1
        ? "selected date labels differ; same-period alignment is not established."
        : "matching date labels alone do not establish comparable measurement times.";
    lines.push(`Application date check: ${comparison} Retrieval-window overlap does not establish date alignment or record correspondence. ${[...byRef.keys()].map(ref => `[${ref}]`).join(" ")}`);
  }
  return lines;
}
