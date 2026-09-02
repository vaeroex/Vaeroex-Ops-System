import "server-only";

import { NextResponse } from "next/server";

const QBO_CUSTOMER_CONNECTIONS_ENABLED_ENV =
  "QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED" as const;

export function qboProductionCustomerConnectionsEnabled() {
  return process.env[QBO_CUSTOMER_CONNECTIONS_ENABLED_ENV] === "true";
}

export function qboCustomerConnectionsUnavailableResponse() {
  return NextResponse.json(
    { ok: false, error: "QuickBooks connections are unavailable." },
    {
      status: 404,
      headers: { "cache-control": "no-store" }
    }
  );
}
