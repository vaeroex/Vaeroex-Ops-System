import "server-only";

import { createHash } from "node:crypto";
import { verifyWorkerAssertion } from "@/lib/document-extraction/broker-auth";
import { verifyBrokerCapability } from "@/lib/document-extraction/broker-capability";
import { documentExtractionBrokerRequestSchema } from "@/lib/document-extraction/broker-contracts";
import { handleDocumentExtractionBrokerOperation } from "@/lib/document-extraction/broker-service";
import {
  consumeDocumentExtractionFileGrant,
  consumeWorkerAssertion
} from "@/lib/document-extraction/broker-store";
import { resolveDocumentExtractionProviderRuntimeContract } from "@/lib/document-extraction/provider-profile";
import {
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
} from "@/lib/document-extraction/contracts";
import {
  assertDocumentExtractionBrokerEnabled,
  assertDocumentExtractionProviderDispatchEnabled,
  type DocumentExtractionRuntimeEnvironment
} from "@/lib/document-extraction/runtime-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BROKER_BODY_BYTES = 8_500_000;

function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function json(body: Record<string, unknown>, status: number) {
  return noStore(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  }));
}

function unavailable() {
  return json({ ok: false, error: "Not found." }, 404);
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
    return json({ ok: false, error: "Worker authorization failed." }, 401);
  }
  if (message.includes("mismatch") || message.includes("invalid") || message.includes("malformed")) {
    return json({ ok: false, error: "The broker request was rejected." }, 400);
  }
  return json({ ok: false, error: "The broker operation failed closed." }, 503);
}

async function authenticate({
  request,
  body,
  runtimeEnvironment,
  environment
}: {
  request: Request;
  body: Uint8Array;
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment;
  environment: NodeJS.ProcessEnv;
}) {
  const assertion = verifyWorkerAssertion({
    request,
    body,
    brokerEnvironment: runtimeEnvironment,
    environment
  });
  await consumeWorkerAssertion(assertion);
  return assertion;
}

async function handlePost({
  request,
  runtimeEnvironment,
  environment
}: {
  request: Request;
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment;
  environment: NodeJS.ProcessEnv;
}) {
  assertDocumentExtractionBrokerEnabled(environment, runtimeEnvironment);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BROKER_BODY_BYTES) {
    return json({ ok: false, error: "Broker request is too large." }, 413);
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.byteLength || body.byteLength > MAX_BROKER_BODY_BYTES) {
    return json({ ok: false, error: "Broker request is invalid." }, 400);
  }
  const assertion = await authenticate({ request, body, runtimeEnvironment, environment });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return json({ ok: false, error: "Broker request is invalid." }, 400);
  }
  const validated = documentExtractionBrokerRequestSchema.safeParse(parsed);
  if (!validated.success) {
    return json({ ok: false, error: "Broker request is invalid." }, 400);
  }
  const result = await handleDocumentExtractionBrokerOperation({
    request: validated.data,
    workerId: assertion.workerId,
    runtimeEnvironment,
    environment
  });
  return json(result, result.ok === false ? 409 : 200);
}

async function handleGet({
  request,
  runtimeEnvironment,
  environment
}: {
  request: Request;
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment;
  environment: NodeJS.ProcessEnv;
}) {
  // A running worker cannot consume a file grant after a provider kill switch.
  assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
  const assertion = await authenticate({
    request,
    body: new Uint8Array(),
    runtimeEnvironment,
    environment
  });
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ ok: false, error: "File authorization is required." }, 401);
  }
  const capability = verifyBrokerCapability({
    token: authorization.slice("Bearer ".length),
    workerId: assertion.workerId,
    expectedKind: "file",
    environment
  });
  if (capability.kind !== "file") throw new Error("document_extraction_file_capability_invalid");
  const providerContract = resolveDocumentExtractionProviderRuntimeContract(environment);
  if (
    providerContract.providerProfile !== NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
    && providerContract.providerProfile !== GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
  ) {
    throw new Error("document_extraction_provider_profile_not_approved");
  }
  const source = await consumeDocumentExtractionFileGrant({
    grantId: capability.grantId,
    workerId: assertion.workerId,
    tokenHash: createHash("sha256").update(capability.secret).digest("hex"),
    providerProfile: providerContract.providerProfile
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
  return noStore(new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": source.mime_type,
      "Content-Length": String(bytes.byteLength)
    }
  }));
}

export async function handleDocumentExtractionBrokerHttpRequest({
  request,
  runtimeEnvironment,
  environment = process.env
}: {
  request: Request;
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment;
  environment?: NodeJS.ProcessEnv;
}) {
  try {
    if (request.method === "POST") {
      return await handlePost({ request, runtimeEnvironment, environment });
    }
    if (request.method === "GET") {
      return await handleGet({ request, runtimeEnvironment, environment });
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    return safeFailure(error);
  }
}
