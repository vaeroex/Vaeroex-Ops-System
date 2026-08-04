import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyWorkerAssertion } from "@/lib/document-extraction/broker-auth";
import { verifyBrokerCapability } from "@/lib/document-extraction/broker-capability";
import { documentExtractionBrokerRequestSchema } from "@/lib/document-extraction/broker-contracts";
import { handleDocumentExtractionBrokerOperation } from "@/lib/document-extraction/broker-service";
import {
  consumeDocumentExtractionFileGrant,
  consumeWorkerAssertion
} from "@/lib/document-extraction/broker-store";
import {
  assertDocumentExtractionBrokerEnabled,
  assertDocumentExtractionProviderDispatchEnabled
} from "@/lib/document-extraction/runtime-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BROKER_BODY_BYTES = 8_500_000;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function unavailable() {
  return noStore(NextResponse.json({ ok: false, error: "Not found." }, { status: 404 }));
}

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "document_extraction_broker_disabled") return unavailable();
  if (
    message.includes("assertion")
    || message.includes("identity")
    || message.includes("capability")
    || message.includes("rpc_denied")
  ) {
    return noStore(NextResponse.json({ ok: false, error: "Worker authorization failed." }, { status: 401 }));
  }
  if (message.includes("mismatch") || message.includes("invalid") || message.includes("malformed")) {
    return noStore(NextResponse.json({ ok: false, error: "The broker request was rejected." }, { status: 400 }));
  }
  return noStore(NextResponse.json({ ok: false, error: "The broker operation failed closed." }, { status: 503 }));
}

async function authenticate(request: Request, body: Uint8Array) {
  const assertion = verifyWorkerAssertion({ request, body });
  await consumeWorkerAssertion(assertion);
  return assertion;
}

export async function POST(request: Request) {
  try {
    assertDocumentExtractionBrokerEnabled();
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BROKER_BODY_BYTES) {
      return noStore(NextResponse.json({ ok: false, error: "Broker request is too large." }, { status: 413 }));
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (!body.byteLength || body.byteLength > MAX_BROKER_BODY_BYTES) {
      return noStore(NextResponse.json({ ok: false, error: "Broker request is invalid." }, { status: 400 }));
    }
    const assertion = await authenticate(request, body);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body).toString("utf8"));
    } catch {
      return noStore(NextResponse.json({ ok: false, error: "Broker request is invalid." }, { status: 400 }));
    }
    const validated = documentExtractionBrokerRequestSchema.safeParse(parsed);
    if (!validated.success) {
      return noStore(NextResponse.json({ ok: false, error: "Broker request is invalid." }, { status: 400 }));
    }
    const result = await handleDocumentExtractionBrokerOperation({
      request: validated.data,
      workerId: assertion.workerId
    });
    return noStore(NextResponse.json(result, { status: result.ok === false ? 409 : 200 }));
  } catch (error) {
    return safeFailure(error);
  }
}

export async function GET(request: Request) {
  try {
    // Re-check the complete application provider contract before consuming the
    // single-use grant. A running worker cannot fetch content after a kill switch.
    assertDocumentExtractionProviderDispatchEnabled();
    const assertion = await authenticate(request, new Uint8Array());
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return noStore(NextResponse.json({ ok: false, error: "File authorization is required." }, { status: 401 }));
    }
    const capability = verifyBrokerCapability({
      token: authorization.slice("Bearer ".length),
      workerId: assertion.workerId,
      expectedKind: "file"
    });
    if (capability.kind !== "file") throw new Error("document_extraction_file_capability_invalid");
    const source = await consumeDocumentExtractionFileGrant({
      grantId: capability.grantId,
      workerId: assertion.workerId,
      tokenHash: createHash("sha256").update(capability.secret).digest("hex")
    });
    const supabase = createSupabaseAdminClient();
    if (!supabase) throw new Error("document_extraction_storage_unavailable");
    const { data, error } = await supabase.storage
      .from(source.storage_bucket)
      .createSignedUrl(source.storage_path, 30);
    if (error || !data?.signedUrl) throw new Error("document_extraction_signed_access_failed");
    const upstream = await fetch(data.signedUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
    if (!upstream.ok) throw new Error("document_extraction_source_fetch_failed");
    const bytes = await upstream.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength !== Number(source.file_size_bytes) || bytes.byteLength > 25_000_000) {
      throw new Error("document_extraction_source_size_mismatch");
    }
    const response = new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": source.mime_type,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
    return noStore(response);
  } catch (error) {
    return safeFailure(error);
  }
}
