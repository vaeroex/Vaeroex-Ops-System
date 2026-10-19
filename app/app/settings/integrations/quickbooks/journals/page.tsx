import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireQboAccountingOwner } from "@/lib/integrations/qbo-customer/accounting-authority";
import { JournalCategorySchema, journalCategoryMatchesAccount } from "@/lib/integrations/provider-runtime/qbo/journal-accounting-v2";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

export const dynamic = "force-dynamic";
const pagePath = "/app/settings/integrations/quickbooks/journals";
const settingsSchema = z.object({ workspaceId: z.string().uuid(), connectionId: z.string().uuid(), authorityId: z.string().uuid().nullable(),
  enabled: z.boolean(), effectiveFrom: z.string().nullable(), accounts: z.array(z.object({ sourceVersionId: z.string().uuid(), recordId: z.string().uuid(),
    name: z.string(), accountType: z.string(), category: JournalCategorySchema.nullable() }).strict()).max(2000) }).strict();
const labels = { revenue: "Revenue", cost_of_goods_sold: "Cost of goods sold", labor: "Labor", other_operating_costs: "Other operating costs", balance_sheet: "Balance sheet" };
async function readSettings(connectionId: string) {
  const access = await requireQboAccountingOwner();
  const client = access.supabase as unknown as ExternalIntegrationsRpcClient;
  const result = await client.rpc("read_qbo_customer_journal_settings_v2", { p_connection_id: z.string().uuid().parse(connectionId) });
  if (result.error) throw Error("Journal settings unavailable");
  const data = settingsSchema.parse(result.data);
  if (data.workspaceId !== access.workspaceId || data.connectionId !== connectionId) throw Error("Journal settings unavailable");
  return { data, client };
}
async function saveAuthority(form: FormData) {
  "use server";
  const connectionId = z.string().uuid().parse(form.get("connectionId"));
  const { data, client } = await readSettings(connectionId);
  const enabled = form.get("action") === "enable";
  if (!enabled && form.get("action") !== "revoke") throw Error("Invalid journal action");
  if (form.get("consent") !== "qbo_journal_revenue_cost_subtotals_v2") throw Error("Confirm the journal policy");
  const expected = z.string().uuid().nullable().parse(form.get("authorityId") || null);
  const effectiveFrom = enabled ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(form.get("effectiveFrom")) : data.effectiveFrom;
  const accountClasses = enabled ? data.accounts.filter(account => form.get("account:" + account.sourceVersionId)).map(account => ({ sourceVersionId: account.sourceVersionId,
    category: JournalCategorySchema.parse(form.get("account:" + account.sourceVersionId)) })) : [];
  const result = await client.rpc("set_qbo_customer_journal_authority_v2", { p_connection_id: connectionId, p_expected_authority_id: expected,
    p_enabled: enabled, p_effective_from: effectiveFrom, p_account_classes: accountClasses, p_consent: "qbo_journal_revenue_cost_subtotals_v2" });
  if (result.error) throw Error("Journal authority was not saved. Reload and review current accounts and authority.");
  redirect(`${pagePath}?connectionId=${connectionId}` as Route);
}
async function processPage(form: FormData) {
  "use server";
  const connectionId = z.string().uuid().parse(form.get("connectionId"));
  const { client } = await readSettings(connectionId);
  const result = await client.rpc("process_qbo_customer_journal_page_v2", { p_connection_id: connectionId,
    p_authority_id: z.string().uuid().parse(form.get("authorityId")) });
  if (result.error) throw Error("Journal processing stopped. Source validation, account classification or authority needs review.");
  const outcome = z.object({ admitted: z.number().int().min(0).max(25), fullPage: z.boolean() }).strict().parse(result.data);
  redirect(`${pagePath}?connectionId=${connectionId}&processed=${outcome.admitted}` as Route);
}
export default async function QuickBooksJournalsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = z.object({ connectionId: z.string().uuid(), processed: z.string().regex(/^\d{1,2}$/).optional() }).strict().parse(await searchParams);
  const { data } = await readSettings(params.connectionId);
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/app/settings/integrations/quickbooks/accounting">Back to accounting settings</Link>
    <h1 className="text-2xl font-semibold">QuickBooks journal subtotals</h1>
    <Link href={`/app/intelligence/briefings/financial?connectionId=${data.connectionId}` as Route} className="block underline">Review a journal period</Link>
    <p>Classify imported accounts to calculate revenue, food or other goods costs, labor and other operating costs from validated, balanced journal entries. Amounts come from original journal lines. Reports and Square sales are not added.</p>
    <p>These are journal subtotals. Other transaction types and complete ledger coverage remain unverified. This policy does not establish Business Health eligibility. Account changes require a new review. Entries referencing unclassified accounts are withheld and prevent an admitted period subtotal.</p>
    <p>Authority: {data.enabled ? "Enabled" : "Not enabled"}</p>
    {params.processed !== undefined && <p role="status">Processed {params.processed} journal entries. Repeat processing if more imported journals remain.</p>}
    <form action={saveAuthority} className="space-y-4">
      <input type="hidden" name="connectionId" value={data.connectionId} /><input type="hidden" name="authorityId" value={data.authorityId ?? ""} /><input type="hidden" name="action" value="enable" />
      <label className="block">Effective date (UTC) <input type="date" name="effectiveFrom" required defaultValue={data.effectiveFrom ?? ""} max={new Date().toISOString().slice(0, 10)} /></label>
      {data.accounts.map(account => <label key={account.sourceVersionId} className="flex flex-wrap items-center gap-3 border-b border-line py-3">
        <span className="flex-1">{account.name} ({account.accountType})</span><select name={`account:${account.sourceVersionId}`} defaultValue={account.category ?? ""} className="rounded border border-line p-2">
          <option value="">Not classified</option>{JournalCategorySchema.options.filter(category => journalCategoryMatchesAccount(category, account.accountType)).map(category => <option key={category} value={category}>{labels[category]}</option>)}
        </select></label>)}
      <label className="flex items-start gap-2"><input required type="checkbox" name="consent" value="qbo_journal_revenue_cost_subtotals_v2" /><span>I approve these account classifications and the journal subtotal policy from the selected date.</span></label>
      <button disabled={!data.accounts.length} type="submit" className="rounded bg-vaeroex-blue p-3 text-white">Save journal authority</button>
    </form>
    {data.enabled && data.authorityId && <>
      <form action={processPage}><input type="hidden" name="connectionId" value={data.connectionId} /><input type="hidden" name="authorityId" value={data.authorityId} /><button type="submit" className="rounded border border-line p-3">Process next 25 imported journals</button></form>
      <form action={saveAuthority} className="space-y-3"><input type="hidden" name="connectionId" value={data.connectionId} /><input type="hidden" name="authorityId" value={data.authorityId} /><input type="hidden" name="action" value="revoke" />
        <label className="flex gap-2"><input required type="checkbox" name="consent" value="qbo_journal_revenue_cost_subtotals_v2" /><span>Revoke journal authority and withhold dependent subtotals and briefs.</span></label><button type="submit" className="rounded border border-line p-3">Revoke journal authority</button>
      </form>
    </>}
  </div>;
}
