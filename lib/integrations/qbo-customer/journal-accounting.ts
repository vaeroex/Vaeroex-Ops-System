import "server-only";
import { z } from "zod";
import { CanonicalDecimalSchema, IsoDateSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { calculateQboJournalPeriodV2 } from "@/lib/integrations/provider-runtime/qbo/journal-accounting-v2";

export const QboJournalPeriodSchema = z.object({
  contractVersion: z.literal("qbo_journal_period_v2"), workspaceId: UuidSchema, connectionId: UuidSchema,
  entityId: UuidSchema, authorityId: UuidSchema, currency: z.string().regex(/^[A-Z]{3}$/), basis: z.literal("accrual"),
  periodStart: IsoDateSchema, periodEnd: IsoDateSchema, recognizedRevenue: CanonicalDecimalSchema,
  costOfGoodsSold: CanonicalDecimalSchema, labor: CanonicalDecimalSchema, otherOperatingCosts: CanonicalDecimalSchema,
  operatingProfit: CanonicalDecimalSchema,
  coverage: z.object({ kind: z.literal("admitted_subtotal"), liveLedgerComplete: z.literal(false),
    journalCount: z.number().int().positive().max(5000), limitation: z.string() }).strict(),
  sourceVersionIds: z.array(UuidSchema).min(1).max(7000), factVersionIds: z.array(UuidSchema).min(1).max(10000),
  sources: z.array(z.object({ recordId: UuidSchema, versionId: UuidSchema, recordType: z.enum(["JournalEntry", "Account"]) }).strict()).min(1).max(7000),
  receiptHash: Sha256FingerprintSchema
}).strict();
export type QboJournalPeriod = z.infer<typeof QboJournalPeriodSchema>;
export type QboJournalPeriodLoad = { state: "available"; data: QboJournalPeriod } | { state: "unavailable"; reason: string };
/** Native RPC rechecks current owner session, entity, policy and all source heads. No admin fallback. */
export async function loadQboJournalPeriod(access: { workspaceId: string; supabase: unknown },
  query: { connectionId: string; periodStart: string; periodEnd: string }): Promise<QboJournalPeriodLoad> {
  const args = z.object({ connectionId: UuidSchema, periodStart: IsoDateSchema, periodEnd: IsoDateSchema }).strict().parse(query);
  const client = access.supabase as ExternalIntegrationsRpcClient;
  const result = await client.rpc("read_qbo_customer_journal_period_v2", {
    p_connection_id: args.connectionId, p_period_start: args.periodStart, p_period_end: args.periodEnd
  });
  if (result.error) return { state: "unavailable", reason: "Journal accounting is unavailable or not authorized." };
  const data = QboJournalPeriodSchema.safeParse(result.data);
  if (!data.success || data.data.workspaceId !== access.workspaceId || data.data.connectionId !== args.connectionId
    || data.data.periodStart !== args.periodStart || data.data.periodEnd !== args.periodEnd)
    return { state: "unavailable", reason: "No complete admitted journal subset is available for this period." };
  const d = data.data;
  const checked = calculateQboJournalPeriodV2([
    { category: "revenue", amount: d.recognizedRevenue }, { category: "cost_of_goods_sold", amount: d.costOfGoodsSold },
    { category: "labor", amount: d.labor }, { category: "other_operating_costs", amount: d.otherOperatingCosts }
  ]);
  if (checked.operatingProfit !== d.operatingProfit || new Set(d.sourceVersionIds).size !== d.sourceVersionIds.length
    || new Set(d.factVersionIds).size !== d.factVersionIds.length
    || d.sources.length !== d.sourceVersionIds.length || new Set(d.sources.map(s => s.versionId)).size !== d.sources.length
    || d.sources.some(s => !d.sourceVersionIds.includes(s.versionId))) return { state: "unavailable", reason: "Journal accounting receipt is inconsistent." };
  return { state: "available", data: d };
}
