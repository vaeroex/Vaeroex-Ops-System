import { handleDocumentExtractionBrokerHttpRequest } from "@/lib/document-extraction/broker-http";
import { resolveVercelDocumentExtractionRuntimeEnvironment } from "@/lib/document-extraction/runtime-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function handle(request: Request) {
  return handleDocumentExtractionBrokerHttpRequest({
    request,
    runtimeEnvironment: resolveVercelDocumentExtractionRuntimeEnvironment()
  });
}

export const GET = handle;
export const POST = handle;
