import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { daySchema, decimalSchema } from "./contracts";
import type { SharedRow } from "./generation";

export type SharedRelationship = Readonly<{
  id: string;
  kind: "financial_stage_boundary";
  fact: string;
  sourceHashes: readonly string[];
  entityId: string;
  date: string;
  currency: string;
}>;
type Input = { row: SharedRow; stage: "order" | "invoice"; value: string; currency: string; date: string };
const currency = z.string().regex(/^[A-Z]{3}$/);

/** Closed non-additivity recipe. It does not infer that two records describe the
 * same transaction, reconcile balances, aggregate partial imports, or assign
 * financial meaning to arbitrary spreadsheet labels or file text. */
export function sharedFinancialBoundaries(rows: readonly SharedRow[]): SharedRelationship[] {
  const inputs: Input[] = [];
  for (const row of rows) {
    if (row.scope.entityBinding !== "protected" || !z.string().uuid().safeParse(row.scope.entityId).success
      || row.scope.timeZone !== "UTC") continue;
    if (!["xero", "zoho-books", "wix-orders"].includes(row.provider)) continue;
    const records = z.array(z.record(z.unknown())).parse(row.data.records);
    for (const record of records) {
      if (row.provider === "xero") {
        const metrics = z.array(z.object({key:z.string(),value:decimalSchema,currency:currency.optional()})).parse(record.metrics);
        for (const metric of metrics) if (metric.key === "billed" && metric.currency && metrics.some(m=>m.key==='invoices'&&m.currency===metric.currency&&m.value==='1') && metrics.some(m=>m.key==='bills'&&m.currency===metric.currency&&m.value==='0')) inputs.push({row,stage:"invoice",value:metric.value,currency:metric.currency,date:daySchema.parse(record.day)});
      } else if (row.provider === "zoho-books") {
        const key = z.array(z.unknown()).parse(record.key);
        if (key[2] === "invoice" && record.counted === true && record.currency === "USD") inputs.push({row,stage:"invoice",value:decimalSchema.parse(record.total),currency:"USD",date:daySchema.parse(record.day)});
      } else {
        const timestamp = z.string().datetime({offset:true}).parse(record.created_at);
        inputs.push({row,stage:"order",value:decimalSchema.parse(record.total_amount),currency:currency.parse(record.currency_code),date:new Date(timestamp).toISOString().slice(0,10)});
      }
    }
  }
  const signals: SharedRelationship[] = [];
  for (const invoice of inputs.filter(input=>input.stage==='invoice')) for (const order of inputs.filter(input=>input.stage==='order')) {
    if (invoice.row.scope.entityId !== order.row.scope.entityId || invoice.currency !== order.currency || invoice.date !== order.date) continue;
    const sourceHashes=[invoice.row.hash,order.row.hash];
    const provider=invoice.row.provider==='xero'?'Xero':'Zoho Books';
    const fact=`For the same business entity and stored date label ${invoice.date}, ${provider} records a billed amount of ${invoice.value} ${invoice.currency} and Wix records an order amount of ${order.value} ${order.currency}. These observations represent different financial stages, so their amounts must not be added. The invoice date has no verified time zone, so these records do not establish the same business day, a matched transaction, or a payment shortfall.`;
    signals.push({id:evidenceEngineHash({kind:'financial_stage_boundary',sourceHashes,date:invoice.date,invoice:invoice.value,order:order.value}),kind:'financial_stage_boundary',fact,sourceHashes,entityId:String(invoice.row.scope.entityId),date:invoice.date,currency:invoice.currency});
  }
  // Bound whole relationships, never a partial list of dependencies. This is a
  // presentation budget, not a connection/provider limit.
  return [...new Map(signals.map(signal=>[signal.id,signal])).values()].slice(0,12);
}
