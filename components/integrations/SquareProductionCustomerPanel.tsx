import type { ProductionSquareCustomerView,ProductionSquareReadView } from "@/lib/integrations/control-plane/square-production-customer-view";

const label = {
  authorization_required: "Authorization required",
  consent_pending: "Authorization in progress",
  mapping_required: "Authorized seller · location mapping required",
  recovery_required: "Connection needs review",
  disconnected: "Disconnected from this workspace"
} as const;

/** No provider IDs, tokens, raw observations or inferred economic values enter
 * this view. Status is always fetched from current workspace authority. */
export function SquareProductionCustomerPanel({ view,reads={} }: { view: ProductionSquareCustomerView;reads?:Record<string,ProductionSquareReadView> }) {
  const entities = new Map(view.businessEntities.map(entity => [entity.id, entity.label]));
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold text-ink">Square Production connection</h1>
    <p className="text-sm text-muted">Connect a Square account to this workspace. Authorization is not a completed data sync or an accounting claim.</p>
    {view.connections.length === 0 ? <p role="status">No Square connection is configured for this workspace.</p> : null}
    {view.connections.map(connection => <section key={connection.connectionId} className="space-y-3 rounded-md border border-line p-4">
      <h2 className="font-semibold">{connection.sellerLabel ?? "Square seller awaiting verification"}</h2>
      <p role="status">{label[connection.state]}</p>
      <p>Business Entity: {entities.get(connection.businessEntityId) ?? "Unavailable"}</p>
      {connection.state === "mapping_required" && !reads[connection.connectionId] ? <p>Location mapping and read access have not been approved. No records are being counted as complete history.</p> : null}
      {reads[connection.connectionId] ? <div className="space-y-3">
        {!reads[connection.connectionId].mappedLocation ? <form action="/api/integrations/square/mapping" method="post">
          <input type="hidden" name="connectionId" value={connection.connectionId}/>
          <label>Verified Square location <select name="locationFingerprint" required defaultValue="">
            <option value="" disabled>Select a location</option>
            {reads[connection.connectionId].locations.map(location=><option key={location.fingerprint} value={location.fingerprint}>{location.label}</option>)}
          </select></label><button type="submit">Confirm this workspace’s location</button>
        </form>:<p>Location mapped: {reads[connection.connectionId].locations.find(location=>location.fingerprint===reads[connection.connectionId].mappedLocation)?.label??"Verified location"}</p>}
        {reads[connection.connectionId].mappedLocation&&reads[connection.connectionId].readStatus==="not_requested"?<form action="/api/integrations/square/read" method="post">
          <input type="hidden" name="connectionId" value={connection.connectionId}/>
          <p>Read the first Payments page for the last 24 hours (up to 100 observations). No continuing synchronization is enabled.</p>
          <button type="submit">Request one read-only Payments page</button>
        </form>:null}
        <p role="status">Payments read: {reads[connection.connectionId].readStatus}. Refresh this page to check the result.</p>
        {reads[connection.connectionId].readStatus==="committed"?<p>{reads[connection.connectionId].observationCount} verified non-economic Payment observations · Square Production · verified {reads[connection.connectionId].verifiedAt}.
          {reads[connection.connectionId].hasMore?" More provider pages exist; they have not been read.":" No continuation was returned for this bounded request."}</p>:null}
        <p>Historical completeness unknown. No revenue, profit, netting, accounting truth, inventory value or complete-history claim.</p>
      </div>:null}
      {connection.state !== "disconnected" ?
        <form action="/api/integrations/square/disconnect" method="post">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <label className="flex gap-2"><input type="checkbox" name="confirmation" value="disconnect" required />
            <span>I confirm this workspace disconnect. Historical records are not deleted.</span></label>
          <button type="submit" className="rounded-md border border-red-300 px-4 py-2 font-semibold text-red-700">Disconnect Square from this workspace</button>
        </form> : null}
    </section>)}
    {view.businessEntities.length > 0 && view.connections.every(connection => connection.state === "disconnected") ?
      <form action="/api/integrations/square/connect" method="post" className="space-y-3 rounded-md border border-line p-4">
        <label className="block font-semibold">Business Entity
          <select name="businessEntityId" required defaultValue="" className="mt-2 block w-full rounded-md border border-line px-3 py-2">
            <option value="" disabled>Select a Business Entity</option>
            {view.businessEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.label}</option>)}
          </select>
        </label>
        <p className="text-sm">Only this workspace’s owner may connect. The Square seller is verified after consent; no seller identity is inferred from this selection.</p>
        <button type="submit" className="rounded-md bg-vaeroex-blue px-4 py-2 font-semibold text-white">Connect Square</button>
      </form> : null}
  </main>;
}
