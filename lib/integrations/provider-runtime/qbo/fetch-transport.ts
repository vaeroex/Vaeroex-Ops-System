import "server-only";

import {
  QBO_REVOCATION_ENDPOINT,
  QBO_TOKEN_ENDPOINT,
  type QboOAuthHttpTransport
} from "@/lib/integrations/provider-runtime/qbo/oauth";
import type { QboRuntimeHttpTransport } from "@/lib/integrations/provider-runtime/qbo/client";

async function boundedResponseBody(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    throw new Error("qbo_http_response_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new Error("qbo_http_response_too_large");
      }
      chunks.push(value);
    }
    const body = Buffer.alloc(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    await reader.cancel().catch(() => undefined);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function responseHeaders(response: Response) {
  return {
    "content-type": response.headers.get("content-type") ?? undefined,
    "retry-after": response.headers.get("retry-after") ?? undefined,
    intuit_tid:
      response.headers.get("intuit_tid") ??
      response.headers.get("intuit-tid") ??
      undefined
  };
}

function signal(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("qbo_http_timeout_invalid");
  }
  return AbortSignal.timeout(timeoutMs);
}

export class FetchQboRuntimeTransport implements QboRuntimeHttpTransport {
  async request(input: Parameters<QboRuntimeHttpTransport["request"]>[0]) {
    const response = await fetch(input.url, {
      method: input.method,
      redirect: "error",
      signal: signal(input.timeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.accessToken}`
      }
    });
    return {
      status: response.status,
      headers: responseHeaders(response),
      body: await boundedResponseBody(response, input.maximumResponseBytes)
    };
  }
}

export class FetchQboOAuthTransport implements QboOAuthHttpTransport {
  async postForm(input: Parameters<QboOAuthHttpTransport["postForm"]>[0]) {
    if (input.url !== QBO_TOKEN_ENDPOINT && input.url !== QBO_REVOCATION_ENDPOINT) {
      throw new Error("qbo_oauth_egress_destination_denied");
    }
    const response = await fetch(input.url, {
      method: "POST",
      redirect: "error",
      signal: signal(input.timeoutMs),
      headers: {
        accept: "application/json",
        authorization: input.authorization,
        "content-type": input.contentType
      },
      body: input.body
    });
    return {
      status: response.status,
      body: await boundedResponseBody(response, input.maximumResponseBytes)
    };
  }
}
