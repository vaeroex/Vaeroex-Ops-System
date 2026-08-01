import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import {
  privacySafeDocumentIntelligenceReport,
  runDocumentIntelligencePocBenchmark
} from "@/lib/ai/document-intelligence-poc/benchmark";
import { nvidiaDocumentIntelligencePocEnabled } from "@/lib/ai/document-intelligence-poc/nvidia-ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

declare global {
  // Temporary Preview qualification state; this route is removed after one bounded replay.
  var vaeroexDocumentIntelligencePocRun: Promise<unknown> | undefined;
}
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

async function requirePreviewAdmin() {
  if (!nvidiaDocumentIntelligencePocEnabled()) {
    return { response: noStore(NextResponse.json({ ok: false, error: "Qualification is unavailable in this environment." }, { status: 404 })) };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { response: noStore(NextResponse.json({ ok: false, error: "Authentication is unavailable." }, { status: 503 })) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: noStore(NextResponse.json({ ok: false, error: "Sign in before running qualification." }, { status: 401 })) };
  if (!isVaeroexAdminUser(user)) return { response: noStore(NextResponse.json({ ok: false, error: "Vaeroex admin access is required." }, { status: 403 })) };
  return { user };
}

export async function GET(request: Request) {
  const authorization = await requirePreviewAdmin();
  if (authorization.response) return authorization.response;
  const confirmed = new URL(request.url).searchParams.get("confirm") === "synthetic-benchmark-v1";
  if (!confirmed) {
    return noStore(NextResponse.json({
      ok: true,
      scope: "synthetic_document_intelligence_benchmark_only",
      providerCredentialPresent: Boolean(process.env.NVIDIA_API_KEY),
      confirmationRequired: true
    }));
  }
  if (!globalThis.vaeroexDocumentIntelligencePocRun) {
    globalThis.vaeroexDocumentIntelligencePocRun = runDocumentIntelligencePocBenchmark();
  }
  try {
    const report = await globalThis.vaeroexDocumentIntelligencePocRun;
    return noStore(NextResponse.json({ ok: true, report: privacySafeDocumentIntelligenceReport(report as Awaited<ReturnType<typeof runDocumentIntelligencePocBenchmark>>) }));
  } catch {
    globalThis.vaeroexDocumentIntelligencePocRun = undefined;
    return noStore(NextResponse.json({ ok: false, error: "The synthetic document benchmark could not be completed." }, { status: 503 }));
  }
}
