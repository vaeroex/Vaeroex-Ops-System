import "server-only";

// No caller-supplied host, redirects, implicit retries, or provider error-body logging.
export async function readJson(url: URL, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 401 || response.status === 403 ? "authorization_required" :
      response.status === 402 || response.status === 429 ? "quota_exceeded" : "provider_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 4 * 1024 * 1024) throw new Error("response_too_large");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function reader(base: string, headers: Record<string, string>, signal: AbortSignal) {
  let calls = 0;
  return async (path: string, query: Record<string, string> = {}) => {
    if (++calls > 12 || !path.startsWith("/") || path.includes("..") || path.includes("?") || path.includes("#") || path.startsWith("//")) {
      throw new Error("read_budget_exceeded");
    }
    const url = new URL(base + path);
    if (url.origin !== new URL(base).origin) throw new Error("invalid_origin");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return readJson(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "Vaeroex Executive Intelligence (hq@vaeroex.com)", ...headers } }, signal);
  };
}
