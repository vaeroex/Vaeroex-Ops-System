import { StatusBadge } from "@/components/operations/StatusBadge";
import { Link2, RefreshCw } from "lucide-react";
import {
  customerConnectionStatus,
  type IntegrationConnectionSummaryRow,
  type IntegrationFreshnessSummaryRow
} from "@/lib/integrations/control-plane/customer-status";

function timestamp(value: string | null) {
  if (!value) return "Not yet available";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ConnectionStatusPanel({
  connections,
  freshness,
  businessEntities,
  canManage
}: {
  connections: readonly IntegrationConnectionSummaryRow[];
  freshness: readonly IntegrationFreshnessSummaryRow[];
  businessEntities: readonly { id: string; display_name: string }[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      {connections.length === 0 ? (
        <p className="text-sm text-muted">No accounting connection is configured.</p>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {connections.map((connection) => {
            const summary = customerConnectionStatus(
              connection,
              freshness.filter((row) => row.connection_id === connection.id)
            );
            return (
              <div
                key={connection.id}
                className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {connection.safe_display_name}
                  </p>
                  <dl className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-ink">Last successful sync</dt>
                      <dd>{timestamp(summary.lastSuccessfulSyncAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-ink">Freshness checked</dt>
                      <dd>{timestamp(summary.freshnessCalculatedAt)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={summary.status} />
                  {canManage && summary.status === "Reauthorization required" ? (
                    <form action="/api/integrations/qbo/reauthorize" method="post">
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <button
                        type="submit"
                        title="Reconnect QuickBooks"
                        aria-label="Reconnect QuickBooks"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink hover:bg-slate-50"
                      >
                        <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canManage && businessEntities.length > 0 ? (
        <form
          action="/api/integrations/qbo/connect"
          method="post"
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <label className="text-sm font-medium text-ink">
            Business entity
            <select
              name="businessEntityId"
              required
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            >
              {businessEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>{entity.display_name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Connection name
            <input
              name="displayName"
              required
              maxLength={120}
              defaultValue="QuickBooks Online"
              className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white"
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            Connect
          </button>
        </form>
      ) : null}
    </div>
  );
}
