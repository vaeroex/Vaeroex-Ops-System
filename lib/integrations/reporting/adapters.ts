import "server-only";
import { z } from "zod";
import { type Account, type Provider, type Snapshot, type Metric, type HistoricalProvider, type HistoryFact, type HistoryImport, catalog } from "./catalog";
import { resolveImportRange } from "../date-range";
import { accountSchema } from "./security";
import { reader } from "./transport";

const number = z.number().finite().min(0).max(1e12);
const decimal = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite().min(-1e12).max(1e12));
const id = z.union([z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]);
const name = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }
function unique<T>(values: T[], identify: (value: T) => string) {
  const seen = new Set<string>();
  for (const value of values) { const key = identify(value); if (seen.has(key)) throw new Error("duplicate_record"); seen.add(key); }
  return values;
}
export async function accounts(provider: Provider, token: string, signal: AbortSignal, form?: URLSearchParams): Promise<Account[]> {
  let found: Account[];
  if (provider === "xero") {
    const get = reader("https://api.xero.com", bearer(token), signal);
    found = z.array(z.object({ tenantId: z.string().uuid(), tenantName: name, tenantType: z.string() })).max(100)
      .parse(await get("/connections")).filter(a => a.tenantType === "ORGANISATION").map(a => ({ id: a.tenantId, name: a.tenantName }));
  } else if (provider === "harvest") {
    const get = reader("https://id.getharvest.com/api/v2", bearer(token), signal);
    found = z.object({ accounts: z.array(z.object({ id, name, product: z.string() })).max(100) }).parse(await get("/accounts"))
      .accounts.filter(a => a.product === "harvest").map(a => ({ id: a.id, name: a.name }));
  } else if (provider === "zoho-inventory") {
    const get = reader("https://www.zohoapis.com/inventory/v1", { Authorization: `Zoho-oauthtoken ${token}` }, signal);
    found = z.object({ code: z.literal(0), organizations: z.array(z.object({ organization_id: id, name, is_org_active: z.boolean() })).max(100) })
      .parse(await get("/organizations")).organizations.filter(a => a.is_org_active).map(a => ({ id: a.organization_id, name: a.name }));
  } else if (provider === "clockify") {
    const get = reader("https://api.clockify.me/api/v1", { "X-Api-Key": token }, signal);
    const user = z.object({ id }).parse(await get("/user"));
    found = z.array(z.object({ id, name })).max(100).parse(await get("/workspaces")).map(a => ({ ...a, user: user.id }));
  } else if (provider === "toggl") {
    if (!/^toggl_sk_/.test(token)) throw new Error("toggl_2_token_required");
    const parent = z.string().regex(/^\d{1,15}$/).parse(form?.get("organizationId"));
    const workspace = z.string().regex(/^\d{1,15}$/).parse(form?.get("accountId"));
    const get = reader("https://focus.toggl.com/api", { ...bearer(token), "Content-Type": "application/json" }, signal);
    // A successful permission-filtered list verifies access to this exact org/workspace pair.
    z.object({ data: z.array(z.object({ id })) }).parse(await get(`/organizations/${parent}/workspaces/${workspace}/projects`, { per_page: "1", page: "1" }));
    found = [{ id: workspace, parent, name: `Toggl workspace ${workspace} (organization ${parent})` }];
  } else {
    const get = reader("https://api.katanamrp.com/v1", bearer(token), signal);
    const factory = z.object({ display_name: name }).parse(await get("/factory"));
    // Katana factory metadata exposes no stable account ID. The immutable key is the account binding.
    found = [{ id: "key-account", name: factory.display_name }];
  }
  return unique(z.array(accountSchema).min(1).max(100).parse(found), a => `${a.parent ?? ""}:${a.id}`);
}

export function validateSnapshot(provider: Provider, snapshot: unknown): Snapshot {
  const parsed = z.object({ start: z.string().datetime(), end: z.string().datetime(), metrics: z.array(z.object({
    key: z.string(), value: number, currency: z.string().regex(/^[A-Z]{3}$/).optional()
  }).strict()).min(1).max(100) }).strict().parse(snapshot);
  if (Date.parse(parsed.start) > Date.parse(parsed.end)) throw new Error("invalid_window");
  for (const m of parsed.metrics) {
    if (!Object.hasOwn(catalog[provider].metrics, m.key) || (provider === "xero") !== Boolean(m.currency)) throw new Error("invalid_metric");
  }
  unique(parsed.metrics, m => `${m.key}:${m.currency ?? ""}`);
  return parsed;
}
export async function snapshot(provider: Provider, token: string, account: Account, signal: AbortSignal, now = new Date()): Promise<Snapshot> {
  return (await readReport(provider, token, account, signal, now)).snapshot;
}
export async function importHistory(provider: HistoricalProvider, token: string, account: Account, signal: AbortSignal,
  requested: ReturnType<typeof resolveImportRange>, now = new Date()): Promise<HistoryImport> {
  // Revalidate at the adapter boundary; callers cannot construct an unbounded or future window.
  const validated = resolveImportRange(requested.startDate, requested.endDate, now);
  const observed = Date.parse(requested.endAt);
  const endDayStart = Date.parse(`${validated.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(observed) || observed < endDayStart || observed > endDayStart+86_400_000 || observed > now.getTime()) {
    throw new Error("invalid_date_range");
  }
  // Preserve the cutoff captured before fetching, including an import that crosses midnight.
  const range = { ...validated, endAt: requested.endAt };
  return (await readReport(provider, token, account, signal, now, range)).history;
}
async function readReport(provider: Provider, token: string, account: Account, signal: AbortSignal, now: Date,
  range?: ReturnType<typeof resolveImportRange>): Promise<{ snapshot: Snapshot; history: HistoryImport }> {
  accountSchema.parse(account);
  const end = range?.endAt ?? now.toISOString(), to = range?.endDate ?? end.slice(0, 10);
  const start = range ? new Date(range.startAt) : new Date(`${to}T00:00:00.000Z`);
  if (!range) start.setUTCDate(start.getUTCDate() - 6);
  const from = range?.startDate ?? start.toISOString().slice(0, 10);
  const facts: HistoryFact[] = [];
  let metrics: Metric[];
  if (provider === "harvest") {
    const get = reader("https://api.harvestapp.com/v2", { ...bearer(token), "Harvest-Account-Id": account.id }, signal);
    const rows: { id: string; spent_date: string; hours: number; billable: boolean; is_running: boolean }[] = [];
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error("snapshot_too_large");
      const result = z.object({ time_entries: z.array(z.object({ id, spent_date: day, hours: number, billable: z.boolean(), is_running: z.boolean() })).max(200),
        next_page: z.number().int().positive().nullable(), page: z.number().int(), total_entries: z.number().int().nonnegative() }).parse(
        await get("/time_entries", { from, to, per_page: "200", page: String(page) }));
      if (result.page !== page) throw new Error("invalid_pagination");
      rows.push(...result.time_entries);
      if (result.next_page === null) { if (rows.length !== result.total_entries) throw new Error("incomplete_snapshot"); break; }
      if (result.next_page !== page + 1) throw new Error("invalid_pagination");
    }
    unique(rows, r => r.id);
    if (rows.some(r => r.spent_date < from || r.spent_date > to)) throw new Error("invalid_window");
    facts.push(...rows.map(r => ({ recordId: r.id, day: r.spent_date, metrics: [
      { key: "entries", value: r.is_running ? 0 : 1 }, { key: "hours", value: r.is_running ? 0 : r.hours },
      { key: "billable_hours", value: !r.is_running && r.billable ? r.hours : 0 }, { key: "running", value: r.is_running ? 1 : 0 }
    ] })));
    const complete = rows.filter(r => !r.is_running);
    metrics = [{ key: "entries", value: complete.length }, { key: "hours", value: complete.reduce((n,r) => n+r.hours,0) },
      { key: "billable_hours", value: complete.filter(r => r.billable).reduce((n,r) => n+r.hours,0) }, { key: "running", value: rows.length-complete.length }];
  } else if (provider === "clockify") {
    if (!account.user) throw new Error("invalid_account");
    const get = reader("https://api.clockify.me/api/v1", { "X-Api-Key": token }, signal);
    const rows: { id: string; billable: boolean; timeInterval: { start: string; end: string | null } }[] = [];
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error("snapshot_too_large");
      const result = z.array(z.object({ id, billable: z.boolean(), timeInterval: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }).nullable() }) })).max(200)
        .parse(await get(`/workspaces/${account.id}/user/${account.user}/time-entries`, { start: start.toISOString(), end, page: String(page), "page-size": "200" }));
      rows.push(...result); if (result.length < 200) break;
    }
    unique(rows, r => r.id);
    let seconds = 0, billable = 0, count = 0, running = 0;
    for (const r of rows) {
      const a = Date.parse(r.timeInterval.start), b = r.timeInterval.end ? Date.parse(r.timeInterval.end) : null;
      if (a > now.getTime() || (b !== null && (b < a || b > now.getTime()))) throw new Error("invalid_window");
      // Clockify may return overlapping entries. Membership is determined by start date;
      // a completed entry that crosses the end boundary retains its entire duration.
      if (a < start.getTime() || a >= Date.parse(end)) continue;
      const hours = b === null ? 0 : (b-a)/3_600_000;
      facts.push({ recordId: r.id, day: new Date(a).toISOString().slice(0, 10), metrics: [
        { key: "entries", value: b === null ? 0 : 1 }, { key: "hours", value: hours },
        { key: "billable_hours", value: r.billable ? hours : 0 }, { key: "running", value: b === null ? 1 : 0 }
      ] });
      if (b === null) { running++; continue; }
      seconds += (b-a)/1000; if (r.billable) billable += (b-a)/1000; count++;
    }
    metrics = [{ key: "entries", value: count }, { key: "hours", value: seconds/3600 }, { key: "billable_hours", value: billable/3600 }, { key: "running", value: running }];
  } else if (provider === "zoho-inventory") {
    const get = reader("https://www.zohoapis.com/inventory/v1", { Authorization: `Zoho-oauthtoken ${token}` }, signal);
    const counts: Record<string, number> = {};
    for (const [key, filter] of [["items", "ItemType.Inventory"], ["low_stock", "Status.Lowstock"]]) {
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        if (page > 5) throw new Error("snapshot_too_large");
        const result = z.object({ code: z.literal(0), items: z.array(z.object({ item_id: id, status: z.enum(["active","inactive"]), item_type: z.string() })).max(200),
          page_context: z.object({ has_more_page: z.boolean() }) }).parse(await get("/items", { organization_id: account.id, filter_by: filter, status: "active", page: String(page), per_page: "200" }));
        ids.push(...result.items.filter(r => r.status === "active" && r.item_type === "inventory").map(r => r.item_id));
        if (!result.page_context.has_more_page) break;
      }
      unique(ids, x => x); counts[key] = ids.length;
    }
    metrics = Object.entries(counts).map(([key, value]) => ({ key, value }));
  } else if (provider === "toggl") {
    if (!account.parent) throw new Error("invalid_account");
    const get = reader("https://focus.toggl.com/api", { ...bearer(token), "Content-Type": "application/json" }, signal);
    const rows: { id: string; total_tracked_secs: number }[] = [];
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error("snapshot_too_large");
      const result = z.object({ data: z.array(z.object({ id, total_tracked_secs: number })).max(100), total: z.number().int().nonnegative(), page: z.number().int() })
        .parse(await get(`/organizations/${account.parent}/workspaces/${account.id}/projects`, { page: String(page), per_page: "100", archived: "false", completed: "false" }));
      if (result.page !== page) throw new Error("invalid_pagination");
      rows.push(...result.data);
      if (rows.length === result.total) break;
      if (rows.length > result.total || result.data.length === 0) throw new Error("incomplete_snapshot");
    }
    unique(rows, r => r.id);
    metrics = [{ key: "projects", value: rows.length }, { key: "hours", value: rows.reduce((n,r) => n+r.total_tracked_secs,0)/3600 }];
  } else if (provider === "katana") {
    const get = reader("https://api.katanamrp.com/v1", bearer(token), signal);
    if (account.id !== "key-account") throw new Error("invalid_account");
    const rows: { variant_id: string; location_id: string; quantity_in_stock: number; quantity_committed: number }[] = [];
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error("snapshot_too_large");
      const result = z.object({ data: z.array(z.object({ variant_id: id, location_id: id,
        quantity_in_stock: decimal, quantity_committed: decimal })).max(250) }).parse(await get("/inventory", { page: String(page), limit: "250" }));
      rows.push(...result.data); if (result.data.length < 250) break;
    }
    unique(rows, r => `${r.variant_id}:${r.location_id}`);
    metrics = [{ key: "stock_rows", value: rows.length }, { key: "unavailable", value: rows.filter(r => r.quantity_in_stock-r.quantity_committed <= 0).length }];
  } else {
    const get = reader("https://api.xero.com/api.xro/2.0", { ...bearer(token), "Xero-Tenant-Id": account.id }, signal);
    const rows: { InvoiceID: string; DateString: string; Type: string; Status: string; CurrencyCode: string; Total?: number; AmountDue?: number }[] = [];
    const d = (s: string) => s.split("-").map(Number).join(",");
    const where = `Date>=DateTime(${d(from)})&&Date<DateTime(${d(new Date(new Date(`${to}T00:00:00Z`).getTime()+86400000).toISOString().slice(0,10))})`;
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error("snapshot_too_large");
      const result = z.object({ Invoices: z.array(z.object({ InvoiceID: z.string().uuid(), DateString: z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00$/), Type: z.enum(["ACCREC","ACCPAY"]),
        Status: z.enum(["DRAFT","SUBMITTED","DELETED","AUTHORISED","PAID","VOIDED"]), CurrencyCode: z.string().regex(/^[A-Z]{3}$/), Total: number.optional(), AmountDue: number.optional() })).max(100) })
        .parse(await get("/Invoices", { where, page: String(page), pageSize: "100",
          Statuses: range ? "DRAFT,SUBMITTED,DELETED,AUTHORISED,PAID,VOIDED" : "AUTHORISED,PAID" }));
      rows.push(...result.Invoices); if (result.Invoices.length < 100) break;
    }
    unique(rows, r => r.InvoiceID);
    const groups = new Map<string, Record<string, number>>();
    for (const r of rows) {
      if (r.DateString.slice(0,10) < from || r.DateString.slice(0,10) > to) throw new Error("invalid_window");
      const included = ["AUTHORISED","PAID"].includes(r.Status);
      const total = included ? number.parse(r.Total) : 0, due = included ? number.parse(r.AmountDue) : 0;
      // Keep excluded-status IDs with zero contributions. A moved-and-voided invoice
      // must replace its old dated contribution even when importing only its new date.
      facts.push({ recordId: r.InvoiceID, day: r.DateString.slice(0, 10), metrics: [
        { key: "invoices", value: included && r.Type === "ACCREC" ? 1 : 0, currency: r.CurrencyCode },
        { key: "billed", value: r.Type === "ACCREC" ? Math.round(total*100)/100 : 0, currency: r.CurrencyCode },
        { key: "outstanding", value: r.Type === "ACCREC" ? Math.round(due*100)/100 : 0, currency: r.CurrencyCode },
        { key: "bills", value: included && r.Type === "ACCPAY" ? 1 : 0, currency: r.CurrencyCode },
        { key: "purchases", value: r.Type === "ACCPAY" ? Math.round(total*100)/100 : 0, currency: r.CurrencyCode }
      ] });
      if (!included) continue;
      const group = groups.get(r.CurrencyCode) ?? { invoices: 0, billed: 0, outstanding: 0, bills: 0, purchases: 0 };
      if (r.Type === "ACCREC") { group.invoices++; group.billed += Math.round(total*100); group.outstanding += Math.round(due*100); }
      else { group.bills++; group.purchases += Math.round(total*100); } groups.set(r.CurrencyCode, group);
    }
    // No currency is invented for an empty result; fetch the organization's base currency.
    if (!groups.size) {
      const org = z.object({ Organisations: z.array(z.object({ BaseCurrency: z.string().regex(/^[A-Z]{3}$/) })).length(1) }).parse(await get("/Organisation"));
      groups.set(org.Organisations[0].BaseCurrency, { invoices: 0, billed: 0, outstanding: 0, bills: 0, purchases: 0 });
    }
    metrics = [...groups].flatMap(([currency, values]) => Object.entries(values).map(([key,value]) => ({ key, currency, value: ["invoices","bills"].includes(key) ? value : value/100 })));
  }
  const pointInTime = ["toggl","katana","zoho-inventory"].includes(provider);
  return { snapshot: validateSnapshot(provider, { start: pointInTime ? end : start.toISOString(), end, metrics }),
    history: { startDate: from, endDate: to, records: facts,
      currencies: [...new Set([...metrics, ...facts.flatMap(f => f.metrics)].flatMap(m => m.currency ? [m.currency] : []))] } };
}
