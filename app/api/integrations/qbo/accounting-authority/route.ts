import { NextResponse } from "next/server";
import { qboCustomerApplicationOrigin } from "@/lib/integrations/control-plane/qbo-customer-oauth";
import {
  qboCustomerConnectionsUnavailableResponse,
  qboProductionCustomerConnectionsEnabled
} from "@/lib/integrations/control-plane/qbo-customer-availability";
import {
  QBO_ACCOUNTING_ERRORS, QBO_ACCOUNTING_PATH, QboAccountingAuthorityError, parseQboAccountingSelection,
  readQboAccountingRequest, readQboAccountingAuthority, requireQboAccountingOwner,
  setQboAccountingAuthority
} from "@/lib/integrations/qbo-customer/accounting-authority";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function failure(error: unknown) {
  const reason = error instanceof QboAccountingAuthorityError ? error.reason : "unavailable";
  const status = reason === "disabled" ? 404 : reason === "denied" ? 403 :
    reason === "stale" || reason === "conflict" ? 409 : reason === "query" ? 400 : 503;
  return NextResponse.json({ ok: false, error: QBO_ACCOUNTING_ERRORS[reason] }, {
    status, headers: { "cache-control": "no-store" }
  });
}

function assertRequestOrigin(request: Request, mutation: boolean) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((mutation || origin !== null) && origin !== qboCustomerApplicationOrigin()) {
    throw new QboAccountingAuthorityError("denied");
  }
  if (site !== null && site !== "same-origin" && (mutation || site !== "none")) {
    throw new QboAccountingAuthorityError("denied");
  }
}

function formRedirect(connectionId: string, error?: unknown) {
  const target = new URL(QBO_ACCOUNTING_PATH, qboCustomerApplicationOrigin());
  target.searchParams.set("connectionId", connectionId);
  if (error) target.searchParams.set("error", error instanceof QboAccountingAuthorityError ? error.reason : "unavailable");
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function ownerAccess() {
  try { return await requireQboAccountingOwner(); }
  catch (error) {
    if (error instanceof QboAccountingAuthorityError) return failure(error);
    throw error;
  }
}

export async function GET(request: Request) {
  if (!qboProductionCustomerConnectionsEnabled()) return qboCustomerConnectionsUnavailableResponse();
  let connectionId;
  try {
    assertRequestOrigin(request, false);
    const entries = [...new URL(request.url).searchParams.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error("duplicate");
    connectionId = parseQboAccountingSelection(Object.fromEntries(entries));
    if (!connectionId) throw Error("missing");
  } catch (error) {
    return failure(error instanceof QboAccountingAuthorityError ? error : new QboAccountingAuthorityError("query"));
  }
  const access = await ownerAccess();
  if (access instanceof Response) return access;
  try {
    const authority = await readQboAccountingAuthority(access, connectionId);
    return NextResponse.json({ ok: true, authority }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!qboProductionCustomerConnectionsEnabled()) return qboCustomerConnectionsUnavailableResponse();
  let input;
  try { assertRequestOrigin(request, true); }
  catch { return failure(new QboAccountingAuthorityError("denied")); }
  try {
    if (new URL(request.url).search) throw Error("unexpected_query");
    input = await readQboAccountingRequest(request);
  } catch { return failure(new QboAccountingAuthorityError("query")); }
  const access = await ownerAccess();
  if (access instanceof Response) return access;
  try {
    const result = await setQboAccountingAuthority(access, input);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() === "application/json") {
      return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
    }
    return formRedirect(input.connectionId);
  } catch (error) {
    return request.headers.get("content-type")?.split(";", 1)[0].trim() === "application/x-www-form-urlencoded"
      ? formRedirect(input.connectionId, error) : failure(error);
  }
}
