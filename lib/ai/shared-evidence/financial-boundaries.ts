import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { daySchema, decimalSchema } from "./contracts";
import type { SharedRow } from "./generation";

export type SharedRelationship = Readonly<{
  id: string;
  kind: "financial_stage_boundary" | "payment_accounting_boundary" | "hours_comparison_boundary" | "inventory_context_boundary" | "sandbox_observation_boundary";
  fact: string;
  sourceHashes: readonly string[];
  entityId: string | null;
  date: string | null;
  currency: string | null;
}>;
type Input = { row: SharedRow; stage: "order" | "invoice"; value: string; currency: string; date: string };
const currency = z.string().regex(/^[A-Z]{3}$/);

/** Closed non-additivity recipe. It does not infer that two records describe the
 * same transaction, reconcile balances, aggregate partial imports, or assign
 * financial meaning to arbitrary spreadsheet labels or file text. */
export function sharedFinancialBoundaries(allRows: readonly SharedRow[]): SharedRelationship[] {
  // Sandbox observations never enter the production payment/accounting recipes.
  const rows=allRows.filter(row=>row.scope.environment!=='sandbox');
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
  for(const square of allRows.filter(row=>row.provider==='square'&&row.scope.environment==='sandbox')) {
    for(const qbo of allRows.filter(row=>row.provider==='quickbooks_online'&&row.scope.environment==='sandbox')) {
      if(!square.scope.entityId||square.scope.entityId!==qbo.scope.entityId||square.data.workspace_id!==qbo.data.workspace_id
        ||square.scope.installationId!==qbo.scope.installationId) continue;
      const sourceHashes=[square.hash,qbo.hash];
      const fact='Reporting period is not established across these sources. Square Sandbox observations and QuickBooks Sandbox accounting records concern the same approved demo business entity. They describe different financial stages and must not be added as extra sales. Square remains non-economic; these records do not establish profit, matched transactions, complete coverage or why amounts differ. Reporting periods and reconciliation must be checked before a numerical comparison. This is Sandbox evidence, not merchant production activity.';
      signals.push({id:evidenceEngineHash({kind:'sandbox_observation_boundary',sourceHashes,fact}),kind:'sandbox_observation_boundary',fact,sourceHashes,entityId:String(square.scope.entityId),date:null,currency:null});
    }
  }
  for (const invoice of inputs.filter(input=>input.stage==='invoice')) for (const order of inputs.filter(input=>input.stage==='order')) {
    if (invoice.row.data.workspace_id !== order.row.data.workspace_id || invoice.row.scope.entityId !== order.row.scope.entityId || invoice.currency !== order.currency || invoice.date !== order.date) continue;
    const sourceHashes=[invoice.row.hash,order.row.hash];
    const provider=invoice.row.provider==='xero'?'Xero':'Zoho Books';
    const fact=`For the same business entity and stored date label ${invoice.date}, ${provider} records a billed amount of ${invoice.value} ${invoice.currency} and Wix records an order amount of ${order.value} ${order.currency}. These observations represent different financial stages, so their amounts must not be added. The invoice date has no verified time zone, so these records do not establish the same business day, a matched transaction, or a payment shortfall.`;
    signals.push({id:evidenceEngineHash({kind:'financial_stage_boundary',sourceHashes,date:invoice.date,invoice:invoice.value,order:order.value}),kind:'financial_stage_boundary',fact,sourceHashes,entityId:String(invoice.row.scope.entityId),date:invoice.date,currency:invoice.currency});
  }
  // These are explanatory boundaries, not arithmetic recipes. Admission has
  // established each record's authority, not complete comparable aggregates.
  const sameEntity=(a:SharedRow,b:SharedRow)=>a.data.workspace_id===b.data.workspace_id
    && a.scope.entityBinding==='protected' && b.scope.entityBinding==='protected'
    && z.string().uuid().safeParse(a.scope.entityId).success && a.scope.entityId===b.scope.entityId;
  const add=(kind:SharedRelationship['kind'],inputs:SharedRow[],fact:string,entityId:string|null)=>{
    fact=`Reporting period is not established across these sources. ${fact.replace(/\s+/g,' ').trim()}`;
    const sourceHashes=[...new Set(inputs.map(row=>row.hash))];
    signals.push({id:evidenceEngineHash({kind,sourceHashes,fact}),kind,fact,sourceHashes,entityId,date:null,currency:null});
  };
  for(const payment of rows.filter(row=>row.provider==='square')) {
    for(const accounting of rows.filter(row=>row.provider==='quickbooks_online'&&sameEntity(payment,row))) {
      add('payment_accounting_boundary',[payment,accounting],
        `Square payment activity and QuickBooks accounting activity concern the same business entity, but their amounts must not be added as extra sales. A POS payment is not profit. Profit requires revenue less expenses on a common accounting basis and period. Refunds, taxes and payment timing require reconciliation before explaining a difference. These observations do not establish that reconciliation or its cause.`,String(payment.scope.entityId));
    }
    for(const hours of rows.filter(row=>['harvest','clockify'].includes(row.provider)&&sameEntity(payment,row))) {
      const hoursFact=hours.facts.find(fact=>/ hours:/.test(fact));if(!hoursFact) continue;
      // Neither current protected projection certifies a complete sales total
      // or matching workforce coverage. No user text can promote it to one.
      add('hours_comparison_boundary',[payment,hours],
        `Square payment records and ${hours.provider==='harvest'?'Harvest':'Clockify'} tracked hours concern the same business entity, but a sales-per-hour or productivity ratio is unavailable. It requires complete sales and time coverage for the same period, time zone and workforce scope, plus a verified currency-unit conversion for the recorded payment minor units. Tracked time is not payroll; a payment record is not a complete sales total.`,String(payment.scope.entityId));
    }
  }
  for(const inventory of rows.filter(row=>['zoho-inventory','katana'].includes(row.provider))) {
    const file=rows.find(row=>row.provider==='file'&&row.data.workspace_id===inventory.data.workspace_id);
    const note=rows.find(row=>row.provider==='business_note'&&row.data.workspace_id===inventory.data.workspace_id);
    if(!file||!note) continue;
    add('inventory_context_boundary',[inventory,file,note],
      `The inventory snapshot, reviewed file and approved note are available, but their presence alone does not support an operational explanation. No shared item, business entity or reporting period is established across these three sources. The file and note are reported context, not independently measured inventory changes; they do not explain why stock changed or prove a shortage.`,null);
  }
  // Bound whole relationships, never a partial list of dependencies. This is a
  // presentation budget, not a connection/provider limit.
  return [...new Map(signals.map(signal=>[signal.id,signal])).values()].slice(0,12);
}

/** Explicit bounded review text is shared by the model prompt and validator. */
export function sharedRelationshipReviewText(kind: `${SharedRelationship['kind']}_v1`): string {
  return {
    financial_stage_boundary_v1:"Review the order and invoice source records before combining financial totals.",
    payment_accounting_boundary_v1:"Review payment and accounting evidence, including period and accounting basis. Reporting period is not established across these sources.",
    hours_comparison_boundary_v1:"Check sales and tracked-time coverage, period, workforce scope and currency units before calculating a ratio. Reporting period is not established across these sources.",
    inventory_context_boundary_v1:"Check item, entity, period and relevance evidence before linking the inventory snapshot to reported context. Reporting period is not established across these sources.",
    sandbox_observation_boundary_v1:"Review both Sandbox originals before making a numerical comparison. Reporting period is not established across these sources; do not treat Sandbox observations as merchant production evidence."
  }[kind];
}
