import { handleDocumentExtractionBrokerHttpRequest } from "@/lib/document-extraction/broker-http";
import { resolveBrokerDocumentExtractionRuntimeEnvironment } from "@/lib/document-extraction/runtime-policy";

const BROKER_PATH = "/api/internal/document-extraction/broker";

function notFound() {
  return new Response('{"ok":false,"error":"Not found."}', {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function handleCloudRunBrokerWebRequest(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env
) {
  const url = new URL(request.url);
  if (
    url.pathname !== BROKER_PATH
    || (request.method !== "GET" && request.method !== "POST")
  ) {
    return Promise.resolve(notFound());
  }
  return handleDocumentExtractionBrokerHttpRequest({
    request,
    runtimeEnvironment: resolveBrokerDocumentExtractionRuntimeEnvironment(environment),
    environment
  });
}
