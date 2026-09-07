import type { SquareConnectionView } from "@/lib/integrations/providers/square/account-connection-contracts";
import { SQUARE_CUSTOMER_API_PATH } from "@/lib/integrations/control-plane/square-customer-routes";

const labels = {
  authorization_required: "Authorization required",
  mapping_required: "Mapping required",
  authorized: "Authorized · sync not yet qualified",
  reauthorization_required: "Reauthorization required",
  disconnecting: "Disconnected locally · provider revocation pending",
  disconnected: "Disconnected",
  revoked: "Authorization revoked",
  recovery_required: "Connection recovery required"
} as const;

/** Only the allowlisted safe view crosses into customer rendering. No freshness inference. */
export function SquareConnectionPanel({ view }: { view: SquareConnectionView }) {
  const entitiesById = new Map(view.businessEntities.map((entity) => [entity.id, entity]));
  return (
    <section className="space-y-6" aria-labelledby="square-connection-heading">
      <div>
        <h1 id="square-connection-heading" className="text-2xl font-semibold text-ink">Square connection</h1>
        <p className="mt-2 text-sm text-muted">Authorize an account, confirm its Business Entity and locations, and manage access.</p>
        <p className="mt-2 text-sm text-muted">Synchronization is not yet qualified. Authorization does not establish complete or current data. Records remain pending and cannot affect accounting.</p>
      </div>
      {!view.canManage ? <p role="status">Your workspace role can view connection status but cannot manage access.</p> : null}
      {view.connections.length === 0 ? <p>No Square connection is configured.</p> : null}
      {view.connections.map((connection) => {
        const entity = entitiesById.get(connection.businessEntityId);
        const locationsById = new Map(connection.locations.map((location) => [location.id, location]));
        const canReauthorize = ["reauthorization_required", "disconnected", "revoked", "recovery_required", "authorization_required"].includes(connection.state);
        const canDisconnect = !["disconnected", "revoked", "disconnecting"].includes(connection.state);
        return (
          <article key={connection.connectionId} className="space-y-4 rounded-md border border-line p-4">
            <h2 className="text-lg font-semibold text-ink">{connection.sellerLabel ?? "Square account awaiting verification"}</h2>
            <p role="status">{labels[connection.state]}</p>
            <p>Business Entity: {entity?.label ?? "Unavailable"}</p>
            {!connection.retentionApproved ? <p>Approved retention and access policy is required before mapping can be enrolled.</p> : null}
            {connection.revocationPending ? <p role="status">Vaeroex access is disabled. Square revocation has not completed; a bounded retry is required.</p> : null}
            {connection.mappedLocationIds.length ? (
              <div><h3 className="font-semibold">Confirmed locations</h3><ul>{connection.mappedLocationIds.map((id) => <li key={id}>{locationsById.get(id)?.label ?? "Previously confirmed location"}</li>)}</ul></div>
            ) : null}
            {view.canManage && connection.state === "mapping_required" ? (
              <form action={`${SQUARE_CUSTOMER_API_PATH}/mapping`} method="post" className="space-y-3">
                <input type="hidden" name="connectionId" value={connection.connectionId} />
                <input type="hidden" name="businessEntityId" value={connection.businessEntityId} />
                <fieldset><legend className="font-semibold">Select verified locations for this Business Entity</legend>
                  {connection.locations.map((location) => <label className="mt-2 flex gap-2" key={location.id}><input type="checkbox" name="locationIds" value={location.id} /><span>{location.label}</span></label>)}
                </fieldset>
                <label className="flex gap-2"><input type="checkbox" name="confirmation" value="map" required /><span>I confirm these locations belong to the Business Entity shown above.</span></label>
                <button type="submit" disabled={!connection.retentionApproved || !entity} className="rounded-md border border-line px-4 py-2 font-semibold disabled:opacity-50">Confirm location mapping</button>
              </form>
            ) : null}
            {view.canManage && canReauthorize ? (
              <form action={`${SQUARE_CUSTOMER_API_PATH}/reauthorize`} method="post">
                <input type="hidden" name="connectionId" value={connection.connectionId} />
                <input type="hidden" name="businessEntityId" value={connection.businessEntityId} />
                <p className="mb-2 text-sm">Reconnect the same seller and Business Entity. Reauthorization cannot move existing data.</p>
                <button type="submit" className="rounded-md border border-line px-4 py-2 font-semibold">Reauthorize Square</button>
              </form>
            ) : null}
            {view.canManage && canDisconnect ? (
              <form action={`${SQUARE_CUSTOMER_API_PATH}/disconnect`} method="post" className="space-y-3">
                <input type="hidden" name="connectionId" value={connection.connectionId} />
                <p className="text-sm">Disconnecting immediately disables local work and revokes this Square seller’s access for this application, including its other connections. Provider revocation may require retry. No historical records are deleted.</p>
                <label className="flex gap-2"><input type="checkbox" name="confirmation" value="disconnect" required /><span>Confirm this Square disconnect.</span></label>
                <button type="submit" className="rounded-md border border-red-300 px-4 py-2 font-semibold text-red-700">Disconnect Square</button>
              </form>
            ) : null}
          </article>
        );
      })}
      {view.canManage && view.businessEntities.length > 0 ? (
        <form action={`${SQUARE_CUSTOMER_API_PATH}/connect`} method="post" className="space-y-3 rounded-md border border-line p-4">
          <label className="block font-semibold">Business Entity
            <select name="businessEntityId" required defaultValue="" className="mt-2 block w-full rounded-md border border-line px-3 py-2">
              <option value="" disabled>Select a Business Entity</option>
              {view.businessEntities.map((entity) => <option value={entity.id} key={entity.id}>{entity.label}</option>)}
            </select>
          </label>
          <p className="text-sm">Choose the intended Business Entity before authorization. Location mapping requires a separate confirmation.</p>
          <button type="submit" className="rounded-md bg-vaeroex-blue px-4 py-2 font-semibold text-white">Connect Square</button>
        </form>
      ) : null}
    </section>
  );
}
