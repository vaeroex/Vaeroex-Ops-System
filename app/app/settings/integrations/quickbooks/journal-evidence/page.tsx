import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireQboAccountingOwner } from "@/lib/integrations/qbo-customer/accounting-authority";
import { JournalCategorySchema } from "@/lib/integrations/provider-runtime/qbo/journal-accounting-v2";
import { CanonicalDecimalSchema, IsoDateSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
export const dynamic = "force-dynamic";
const common = { workspaceId: UuidSchema, connectionId: UuidSchema, recordId: UuidSchema, versionId: UuidSchema,
  receiptHash: Sha256FingerprintSchema, periodStart: IsoDateSchema, periodEnd: IsoDateSchema };
const evidenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("account"), accountRef: z.string().min(1), name: z.string().nullable(), accountType: z.string(),
    category: JournalCategorySchema, policyVersion: z.literal("qbo_journal_accounting_v2") }).strict(),
  z.object({ ...common, kind: z.literal("journal"), providerRecordId: z.string(), postingDate: IsoDateSchema, currency: z.string().regex(/^[A-Z]{3}$/),
    lines: z.array(z.object({ lineId: z.string(), accountRef: z.string(), postingType: z.enum(["debit", "credit"]), amount: CanonicalDecimalSchema,
      currency: z.string().regex(/^[A-Z]{3}$/), category: JournalCategorySchema }).strict()).min(2).max(500) }).strict()
]);
export default async function JournalEvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireQboAccountingOwner();
  const query = z.object({ connectionId: UuidSchema, from: IsoDateSchema, to: IsoDateSchema, versionId: UuidSchema }).strict().parse(await searchParams);
  const result = await (access.supabase as unknown as ExternalIntegrationsRpcClient).rpc("read_qbo_customer_journal_evidence_v2", {
    p_connection_id: query.connectionId, p_period_start: query.from, p_period_end: query.to, p_source_version_id: query.versionId
  });
  const parsed = evidenceSchema.safeParse(result.data);
  if (result.error || !parsed.success || parsed.data.workspaceId !== access.workspaceId || parsed.data.connectionId !== query.connectionId
    || parsed.data.versionId !== query.versionId || parsed.data.periodStart !== query.from || parsed.data.periodEnd !== query.to)
    return <p>Journal evidence is unavailable, changed, or not authorized. Return to the period to revalidate its sources.</p>;
  const data = parsed.data;
  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href={`/app/intelligence/briefings/financial?connectionId=${query.connectionId}&from=${query.from}&to=${query.to}` as Route} className="underline">Return to journal period</Link>
    <h1 className="text-2xl font-semibold">{data.kind === "account" ? "Account classification evidence" : "Journal line evidence"}</h1>
    <p>Exact stored source version admitted for {data.periodStart} – {data.periodEnd}. Full ledger coverage remains unverified.</p>
    <dl className="break-all text-sm"><dt>Source record</dt><dd>{data.recordId}</dd><dt>Source version</dt><dd>{data.versionId}</dd><dt>Current period receipt</dt><dd>{data.receiptHash}</dd></dl>
    {data.kind === "account" ? <dl className="space-y-2"><dt>Account</dt><dd>{data.name ?? data.accountRef}</dd><dt>Provider account reference</dt><dd>{data.accountRef}</dd><dt>Provider account type</dt><dd>{data.accountType}</dd><dt>Owner-approved classification</dt><dd>{data.category.replaceAll("_", " ")}</dd><dt>Policy version</dt><dd>{data.policyVersion}</dd></dl>
      : <><p>Journal {data.providerRecordId} · {data.postingDate} · {data.currency}</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Line</th><th>Account reference</th><th>Posting</th><th>Amount</th><th>Approved category</th></tr></thead>
        <tbody>{data.lines.map(line => <tr key={line.lineId} className="border-t border-line"><td className="py-3">{line.lineId}</td><td>{line.accountRef}</td><td>{line.postingType}</td><td>{line.currency} {line.amount}</td><td>{line.category.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
        <p className="text-sm">Revenue uses credits less debits. Cost categories use debits less credits. Balance-sheet lines balance the journal and do not contribute to these income and expense subtotals.</p></>}
  </div>;
}
