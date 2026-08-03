import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const PILOT_BRANCH = "codex/nvidia-document-intelligence-poc";
const PILOT_CONFIRMATION = "synthetic-routing-measurement-v1";
const MAX_REQUEST_BYTES = 2_500_000;

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function unavailable(status = 404) {
  return Response.json(
    { ok: false, error: "The synthetic Preview qualification proxy is unavailable." },
    { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }
  );
}

function validHostedPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.model !== "nvidia/nemotron-parse" || payload.stream === true) return false;
  if (!Array.isArray(payload.messages) || payload.messages.length !== 1) return false;
  const message = payload.messages[0];
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content) || content.length !== 1) return false;
  const image = content[0];
  if (!image || typeof image !== "object" || Array.isArray(image)) return false;
  const imageUrl = (image as Record<string, unknown>).image_url;
  if (!imageUrl || typeof imageUrl !== "object" || Array.isArray(imageUrl)) return false;
  const url = (imageUrl as Record<string, unknown>).url;
  return typeof url === "string" && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url);
}

export async function POST(request: Request) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== PILOT_BRANCH ||
    !enabled(process.env.VAEROEX_DOCUMENT_ROUTER_PILOT) ||
    !enabled(process.env.VAEROEX_NVIDIA_DOCUMENT_PILOT) ||
    !enabled(process.env.VAEROEX_NVIDIA_DOCUMENT_SHADOW_CONFIRMATION) ||
    new URL(request.url).searchParams.get("confirm") !== PILOT_CONFIRMATION
  ) {
    return unavailable();
  }

  const proxyToken = process.env.VAEROEX_NVIDIA_DOCUMENT_PILOT_PROXY_TOKEN?.trim() || "";
  const providerKey = process.env.NVIDIA_API_KEY?.trim() || "";
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (proxyToken.length < 32 || providerKey.length < 32 || !secureEqual(suppliedToken, proxyToken)) {
    return unavailable(401);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return unavailable(413);
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_REQUEST_BYTES) return unavailable(413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return unavailable(400);
  }
  if (!validHostedPayload(payload)) return unavailable(400);

  const response = await fetch(NVIDIA_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${providerKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...payload, store: false }),
    cache: "no-store"
  });
  const responseBody = await response.arrayBuffer();
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("content-type") || "application/json",
    "X-Robots-Tag": "noindex, nofollow"
  });
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return new Response(responseBody, { status: response.status, headers });
}
