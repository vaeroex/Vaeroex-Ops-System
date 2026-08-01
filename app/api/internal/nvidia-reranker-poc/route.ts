import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import {
  RERANKER_POC_MAX_PROVIDER_REQUESTS,
  RERANKER_POC_PLANNED_PROVIDER_REQUESTS,
  privacySafeRerankerPocQualificationReport,
  runNvidiaRerankerPocQualification
} from "@/lib/ai/evidence-engine/benchmark";
import {
  NVIDIA_RERANKER_POC_FIXTURES,
  assertSyntheticRerankerPocCandidates,
  rerankerPocFixtureCandidates
} from "@/lib/ai/evidence-engine/reranker-poc-fixtures";
import {
  NvidiaTextReranker,
  nvidiaTextRerankerShadowEnabled
} from "@/lib/ai/evidence-engine/nvidia-text-reranker";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONFIRMATION = "run-synthetic-nvidia-reranker-poc-v1";
let activeRun: Promise<ReturnType<typeof privacySafeRerankerPocQualificationReport>> | null = null;
let completedRun: ReturnType<typeof privacySafeRerankerPocQualificationReport> | null = null;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function previewEnabled() {
  return process.env.VERCEL_ENV === "preview" && nvidiaTextRerankerShadowEnabled();
}

async function requirePreviewAdmin() {
  if (!previewEnabled()) {
    return { response: noStore(NextResponse.json({ ok: false, error: "Reranker qualification is unavailable." }, { status: 404 })) };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { response: noStore(NextResponse.json({ ok: false, error: "Authentication is unavailable." }, { status: 503 })) };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { response: noStore(NextResponse.json({ ok: false, error: "Sign in before running qualification." }, { status: 401 })) };
  }
  if (!isVaeroexAdminUser(user)) {
    return { response: noStore(NextResponse.json({ ok: false, error: "Vaeroex admin access is required." }, { status: 403 })) };
  }
  return { user };
}

function assertSyntheticQualificationBoundary() {
  if (process.env.VERCEL_ENV !== "preview") throw new Error("The reranker POC refuses non-Preview execution.");
  if (!nvidiaTextRerankerShadowEnabled()) throw new Error("The explicit reranker POC gates are not enabled.");
  if (!process.env.NVIDIA_API_KEY?.trim() && !process.env.NVIDIA_RERANK_API_KEY?.trim()) {
    throw new Error("The Preview NVIDIA credential is unavailable.");
  }
  if (NVIDIA_RERANKER_POC_FIXTURES.length !== 24) throw new Error("The committed synthetic fixture set is incomplete.");
  if (RERANKER_POC_PLANNED_PROVIDER_REQUESTS > RERANKER_POC_MAX_PROVIDER_REQUESTS) {
    throw new Error("The planned provider calls exceed the approved hard limit.");
  }
  for (const fixture of NVIDIA_RERANKER_POC_FIXTURES) {
    assertSyntheticRerankerPocCandidates(rerankerPocFixtureCandidates(fixture));
  }
}

export async function GET() {
  const authorization = await requirePreviewAdmin();
  if (authorization.response) return authorization.response;
  return noStore(NextResponse.json({
    ok: true,
    preview: process.env.VERCEL_ENV === "preview",
    explicitGatesEnabled: nvidiaTextRerankerShadowEnabled(),
    credentialPresent: Boolean(process.env.NVIDIA_API_KEY?.trim() || process.env.NVIDIA_RERANK_API_KEY?.trim()),
    syntheticFixtureCount: NVIDIA_RERANKER_POC_FIXTURES.length,
    plannedProviderRequests: RERANKER_POC_PLANNED_PROVIDER_REQUESTS,
    hardProviderRequestLimit: RERANKER_POC_MAX_PROVIDER_REQUESTS,
    completedInThisInstance: completedRun !== null,
    runningInThisInstance: activeRun !== null
  }));
}

export async function POST(request: Request) {
  const authorization = await requirePreviewAdmin();
  if (authorization.response) return authorization.response;
  const body = (await request.json().catch(() => null)) as { confirmation?: unknown } | null;
  if (body?.confirmation !== CONFIRMATION) {
    return noStore(NextResponse.json({ ok: false, error: "Explicit synthetic benchmark confirmation is required." }, { status: 400 }));
  }
  if (completedRun) return noStore(NextResponse.json({ ok: true, reused: true, report: completedRun }));
  if (activeRun) {
    return noStore(NextResponse.json({ ok: false, error: "The synthetic benchmark is already running." }, { status: 409 }));
  }

  try {
    assertSyntheticQualificationBoundary();
    activeRun = runNvidiaRerankerPocQualification({ reranker: new NvidiaTextReranker() })
      .then(privacySafeRerankerPocQualificationReport);
    completedRun = await activeRun;
    return noStore(NextResponse.json({ ok: true, reused: false, report: completedRun }));
  } catch {
    return noStore(NextResponse.json({ ok: false, error: "The synthetic NVIDIA benchmark could not be completed." }, { status: 503 }));
  } finally {
    activeRun = null;
  }
}
