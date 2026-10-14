import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/operations/PageHeader";
import {
  ReportSchema,
  ShopSchema,
  decimal,
  units,
} from "@/lib/integrations/shopify/contracts";
import {
  lifecycle,
  manager,
  shopifyEnabled,
} from "@/lib/integrations/shopify/server";

export const dynamic = "force-dynamic";
const View = z.object({
  shop: ShopSchema,
  status: z.string(),
  report: ReportSchema.nullable(),
  updatedAt: z.string(),
});
const labels: Record<string, string> = {
  pending: "Waiting for Shopify",
  exchanging: "Finishing authorization",
  connected: "Connected",
  reauthorization_required: "Reconnect required",
  disconnected: "Disconnected",
};
const messages: Record<string, string> = {
  privacy_window:
    "A privacy request cleared the previous report. A new report can be read after the next complete UTC day.",
  connected: "Shopify is connected. Read your first report below.",
  synced: "Your Shopify report is up to date.",
  disconnected:
    "The connection and saved report have been removed from Vaeroex. To revoke Shopify's authorization too, uninstall Vaeroex Executive Intelligence in your Shopify admin.",
  failed:
    "The request could not be completed. Your last saved report, if any, has not been replaced. Reconnect if authorization has expired; otherwise try again.",
  report_too_large:
    "This store exceeds the current report limit. No partial report was saved. Contact Vaeroex support for a larger-store import.",
  rate_limited:
    "Shopify is temporarily limiting requests. Try again in a few minutes.",
  reconnect: "Shopify authorization needs to be renewed. Reconnect your store.",
};
const money = (value: string, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value),
  );
export default async function ShopifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await manager(false),
    enabled = shopifyEnabled(),
    params = await searchParams;
  let view: z.infer<typeof View> | null = null,
    unavailable = false;
  try {
    const data = await lifecycle("view", access);
    view = data ? View.parse(data) : null;
  } catch {
    unavailable = true;
  }
  const result =
      typeof params.result === "string" ? messages[params.result] : null,
    report = view?.report;
  const totals = new Map<
    string,
    { orders: number; cancelled: number; value: bigint; refunded: bigint }
  >();
  for (const day of report?.days ?? []) {
    const t = totals.get(day.currency) ?? {
      orders: 0,
      cancelled: 0,
      value: BigInt(0),
      refunded: BigInt(0),
    };
    t.orders += day.orders;
    t.cancelled += day.cancelled;
    t.value += units(day.orderTotal);
    t.refunded += units(day.refunded);
    totals.set(day.currency, t);
  }
  return (
    <div className="workspace-page mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Integrations"
        title="Shopify"
        description="Understand order activity and refunds from your online store."
      />
      <Link
        href="/app/integrations"
        className="text-sm text-vaeroex-blue underline"
      >
        All integrations
      </Link>
      {result ? (
        <p role="status" className="rounded-lg border border-line bg-white p-4">
          {result}
        </p>
      ) : null}
      <section
        className="rounded-lg border border-line bg-white p-5 space-y-4"
        aria-labelledby="connection-title"
      >
        <h2 id="connection-title" className="text-lg font-semibold">
          Your store
        </h2>
        <p>
          {view
            ? `${view.shop} · ${labels[view.status] ?? "Status unavailable"}`
            : "No store connected"}
        </p>
        {!enabled ? (
          <p>
            Shopify is being prepared for a pilot. Store connections will be
            available after setup and Shopify testing are complete.
          </p>
        ) : null}
        {unavailable ? (
          <p role="alert">
            Connection status is unavailable. Please try again later.
          </p>
        ) : null}
        {enabled && !unavailable && view?.status !== "connected" ? (
          <form
            action="/api/integrations/shopify/connect"
            method="post"
            className="space-y-3"
          >
            <label htmlFor="shopify-shop" className="block font-medium">
              Shopify store address
            </label>
            <input
              id="shopify-shop"
              name="shop"
              type="text"
              required
              maxLength={80}
              defaultValue={view?.shop}
              readOnly={Boolean(view)}
              placeholder="your-store.myshopify.com"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-line p-3"
            />
            <p className="text-sm text-muted">
              Use the original myshopify.com address shown in Shopify settings.
              One store can be connected to this workspace.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="mt-1"
              />
              <span>
                I authorize Vaeroex to read this store’s order totals and
                refunds for business analysis. I will approve access in Shopify
                next.
              </span>
            </label>
            <button className="rounded-md bg-vaeroex-blue px-4 py-3 text-white font-semibold">
              {view ? "Reconnect Shopify" : "Connect Shopify"}
            </button>
          </form>
        ) : null}
        {enabled && view?.status === "connected" ? (
          <form
            action="/api/integrations/shopify/sync"
            method="post"
            className="space-y-3"
          >
            <p>
              Read the last 30 complete days in UTC, up to 10,000 orders. Only
              daily totals are saved. Each read replaces the saved report.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="mt-1"
              />
              <span>
                Read Shopify and replace this workspace’s saved order report.
              </span>
            </label>
            <button className="rounded-md bg-vaeroex-blue px-4 py-3 text-white font-semibold">
              Read Shopify report
            </button>
          </form>
        ) : null}
      </section>
      {report ? (
        <section
          className="rounded-lg border border-line bg-white p-5 space-y-4"
          aria-labelledby="report-title"
        >
          <h2 id="report-title" className="text-lg font-semibold">
            Order performance
          </h2>
          <p className="text-sm text-muted">
            Orders created from {report.start.slice(0, 10)} to{" "}
            {report.end.slice(0, 10)} (end exclusive, UTC). Last read:{" "}
            {report.syncedAt.replace("T", " ").slice(0, 19)} UTC.
          </p>
          <p className="text-sm text-muted">
            Order value includes taxes, shipping, unpaid and cancelled orders.
            Refunds are attributed to the order’s creation date. These are
            operational totals, not recognized revenue or profit. Test orders
            are excluded. Privacy requests can shorten the reporting window.
          </p>
          {!report.orderCount ? (
            <p>No non-test orders were found in this period.</p>
          ) : null}
          {[...totals].map(([currency, t]) => (
            <div
              key={currency}
              className="grid gap-4 sm:grid-cols-4 rounded-md border border-line p-4"
            >
              <div>
                <p className="text-sm text-muted">Orders ({currency})</p>
                <p className="text-xl font-semibold">
                  {t.orders.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">Order value</p>
                <p className="text-xl font-semibold">
                  {money(decimal(t.value), currency)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">Refunded</p>
                <p className="text-xl font-semibold">
                  {money(decimal(t.refunded), currency)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">Cancelled orders</p>
                <p className="text-xl font-semibold">
                  {t.cancelled.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
          {report.days.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <caption className="text-left font-semibold py-3">
                  Daily totals · days with orders
                </caption>
                <thead>
                  <tr>
                    {[
                      "Date (UTC)",
                      "Currency",
                      "Orders",
                      "Order value",
                      "Refunded",
                      "Cancelled",
                    ].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="p-2 border-b border-line"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={`${d.day}-${d.currency}`}>
                      <th scope="row" className="p-2 font-normal">
                        {d.day}
                      </th>
                      <td className="p-2">{d.currency}</td>
                      <td className="p-2">{d.orders}</td>
                      <td className="p-2">{money(d.orderTotal, d.currency)}</td>
                      <td className="p-2">{money(d.refunded, d.currency)}</td>
                      <td className="p-2">{d.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      {view ? (
        <section className="rounded-lg border border-line bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold">Disconnect Shopify</h2>
          <p>
            Delete the saved report and credentials from Vaeroex. Also uninstall
            Vaeroex Executive Intelligence in Shopify admin to revoke
            authorization there.
          </p>
          <form
            action="/api/integrations/shopify/disconnect"
            method="post"
            className="space-y-3"
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="mt-1"
              />
              <span>
                Disconnect this store and delete its saved report from Vaeroex.
              </span>
            </label>
            <button className="rounded-md border border-line px-4 py-3 font-semibold">
              Disconnect and delete report
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
