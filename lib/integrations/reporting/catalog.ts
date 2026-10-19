export const providers = ["xero", "harvest", "zoho-inventory", "clockify", "toggl", "katana"] as const;
export type Provider = typeof providers[number];
export type HistoricalProvider = "xero" | "harvest" | "clockify";
export function isHistoricalProvider(value: Provider): value is HistoricalProvider {
  return value === "xero" || value === "harvest" || value === "clockify";
}
export function isProvider(value: string): value is Provider {
  return (providers as readonly string[]).includes(value);
}
export const catalog: Record<Provider, { name: string; auth: "oauth" | "key"; description: string; permission: string; metrics: Record<string, string> }> = {
  xero: { name: "Xero", auth: "oauth", description: "Import and retain invoice and bill history for selected dates, separated by currency.",
    permission: "Read organization details and invoices/bills. No journals, payroll, payments, or bank access. Free developer capacity is limited to five organizations.",
    metrics: { invoices: "Sales invoices", billed: "Sales invoice total", outstanding: "Outstanding when last imported", bills: "Purchase bills", purchases: "Purchase bill total" } },
  harvest: { name: "Harvest", auth: "oauth", description: "Import and retain tracked and billable hours for selected dates, within your Harvest permissions.",
    permission: "Harvest grants account access that can include writes. Vaeroex only reads account details and time entries; it stores entry IDs, dates and numeric totals, not employee names, rates, or notes. Totals depend on your Harvest role.",
    metrics: { entries: "Completed time entries", hours: "Tracked hours", billable_hours: "Billable hours", running: "Running entries excluded" } },
  "zoho-inventory": { name: "Zoho Inventory", auth: "oauth", description: "Current inventory item and low-stock counts, separate from Zoho Books accounting.",
    permission: "Read organization settings and items in the U.S. data center. No orders, invoices, contacts, or inventory adjustments are changed.",
    metrics: { items: "Active inventory items", low_stock: "Items at low stock" } },
  clockify: { name: "Clockify", auth: "key", description: "Import and retain your time-entry history by entry start date in UTC.",
    permission: "The API key inherits your Clockify permissions, which may include writes. Vaeroex only reads your workspaces and your own completed time entries. This is not a team payroll or labor-cost report.",
    metrics: { entries: "Your completed time entries", hours: "Your tracked hours", billable_hours: "Your billable hours", running: "Running entries excluded" } },
  toggl: { name: "Toggl 2.0", auth: "key", description: "Current active project counts and tracked time on those projects.",
    permission: "Use a Toggl 2.0 bearer token, not a legacy Track token. It inherits all your account permissions. Vaeroex only reads the selected workspace's visible active projects; project hours are lifetime totals, not a weekly timesheet.",
    metrics: { projects: "Visible active projects", hours: "Lifetime hours on these projects" } },
  katana: { name: "Katana", auth: "key", description: "Current stock availability counts for your Katana account.",
    permission: "Private API key connection only; public OAuth partnership is not approved. Keys can have broader permissions. Vaeroex only reads inventory; it never changes stock or orders.",
    metrics: { stock_rows: "Variant/location stock records", unavailable: "Records with no available stock" } }
};
export type Metric = { key: string; value: number; currency?: string };
export type Snapshot = { start: string; end: string; metrics: Metric[] };
export type HistoryFact = { recordId: string; day: string; metrics: Metric[] };
export type HistoryImport = { startDate: string; endDate: string; records: HistoryFact[]; currencies: string[] };
export type HistoryReport = { metrics: Metric[]; records: number; hasHistory: boolean; coverage: {
  days: number; completeDays: number; incompleteDays: number; coveredThrough: string | null;
  startDate: string | null; endDate: string | null; lastImportedAt: string | null;
} };
export type Account = { id: string; name: string; parent?: string; user?: string };
