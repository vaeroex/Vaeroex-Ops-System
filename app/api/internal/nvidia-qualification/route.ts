import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { getQualificationFixtureMetadata } from "@/lib/ai/qualification/contracts";
import { getQualificationModelProfiles } from "@/lib/ai/qualification/profiles";
import { runStageOneQualificationProbe } from "@/lib/ai/qualification/stage-one";
import {
  QUALIFICATION_CONTRACT_IDS,
  type QualificationContractId
} from "@/lib/ai/qualification/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
function previewQualificationEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

async function requirePreviewAdmin() {
  if (!previewQualificationEnabled()) {
    return { response: noStore(NextResponse.json(
      { ok: false, error: "Qualification is unavailable in this environment." },
      { status: 404 }
    )) };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { response: noStore(NextResponse.json(
      { ok: false, error: "Authentication is unavailable." },
      { status: 503 }
    )) };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { response: noStore(NextResponse.json(
      { ok: false, error: "Sign in before running qualification." },
      { status: 401 }
    )) };
  }
  if (!isVaeroexAdminUser(user)) {
    return { response: noStore(NextResponse.json(
      { ok: false, error: "Vaeroex admin access is required." },
      { status: 403 }
    )) };
  }
  return { user };
}

function validProbeRequest({
  profileId,
  contractId,
  runIndex
}: {
  profileId: string;
  contractId: string;
  runIndex: number | null;
}) {
  if (!profileId || !QUALIFICATION_CONTRACT_IDS.includes(contractId as QualificationContractId)) {
    return "A valid profile and Stage 1 contract are required.";
  }
  if (runIndex !== null && (!Number.isInteger(runIndex) || runIndex < 1 || runIndex > 3)) {
    return "Stage 1 runIndex must be between 1 and 3.";
  }
  return null;
}

async function probeResponse({
  profileId,
  contractId,
  runIndex
}: {
  profileId: string;
  contractId: string;
  runIndex: number | null;
}) {
  const invalid = validProbeRequest({ profileId, contractId, runIndex });
  if (invalid) {
    return noStore(NextResponse.json({ ok: false, error: invalid }, { status: 400 }));
  }
  try {
    const result = await runStageOneQualificationProbe({
      profileId,
      contractId: contractId as QualificationContractId
    });
    console.log(JSON.stringify({
      level: "info",
      component: "nvidia-capability-qualification",
      event: "stage_one_probe",
      benchmarkVersion: result.benchmarkVersion,
      profileId: result.profileId,
      provider: result.provider,
      model: result.model,
      reasoningMode: result.reasoningMode,
      contractId: result.contractId,
      runIndex,
      endpointHealthy: result.endpointHealthy,
      completed: result.completed,
      contractValid: result.contractValid,
      validationReasonCode: result.validationReasonCode,
      validationStage: result.validationStage,
      validationExpectedField: result.validationExpectedField,
      validationExpectedType: result.validationExpectedType,
      validationObservedType: result.validationObservedType,
      validationExpectedCount: result.validationExpectedCount,
      validationObservedCount: result.validationObservedCount,
      validationFieldPresent: result.validationFieldPresent,
      finishReason: result.finishReason,
      truncationDetected: result.truncationDetected,
      reasoningContentDetected: result.reasoningContentDetected,
      latencyMs: result.latencyMs,
      firstByteMs: result.firstByteMs,
      firstTokenMs: result.firstTokenMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      tokenCountsEstimated: result.tokenCountsEstimated,
      outputCharacters: result.outputCharacters,
      transportFailureCode: result.transportFailureCode
    }));
    return noStore(NextResponse.json({ ok: true, runIndex, result }));
  } catch {
    console.error(JSON.stringify({
      level: "error",
      component: "nvidia-capability-qualification",
      event: "stage_one_probe_failed",
      profileId,
      contractId,
      runIndex,
      failureCode: "internal_failure"
    }));
    return noStore(NextResponse.json(
      { ok: false, error: "The qualification probe could not be completed." },
      { status: 503 }
    ));
  }
}

export async function GET(request: Request) {
  const authorization = await requirePreviewAdmin();
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId")?.trim() || "";
  const contractId = url.searchParams.get("contractId")?.trim() || "";
  const runIndexValue = url.searchParams.get("runIndex");
  if (profileId || contractId || runIndexValue !== null) {
    const runIndex = runIndexValue === null ? null : Number(runIndexValue);
    return probeResponse({ profileId, contractId, runIndex });
  }
  return noStore(NextResponse.json({
    ok: true,
    benchmarkVersion: "nvidia_capability_stage_1_v1",
    scope: [
      "business_health_explanation_v1",
      "executive_brief_benchmark_v1",
      "leadership_priorities_benchmark_v1"
    ],
    excluded: ["deep_strategic_analysis"],
    profiles: getQualificationModelProfiles().map((profile) => ({
      id: profile.id,
      provider: profile.provider,
      model: profile.model,
      reasoningMode: profile.reasoningMode,
      maxOutputTokens: profile.maxOutputTokens
    })),
    fixtures: getQualificationFixtureMetadata(),
    credentials: {
      nvidiaPresent: Boolean(process.env.NVIDIA_API_KEY?.trim()),
      openaiPresent: Boolean(process.env.OPENAI_API_KEY?.trim())
    }
  }));
}

export async function POST(request: Request) {
  const authorization = await requirePreviewAdmin();
  if (authorization.response) return authorization.response;
  const body = (await request.json().catch(() => null)) as {
    profileId?: unknown;
    contractId?: unknown;
    runIndex?: unknown;
  } | null;
  const profileId = typeof body?.profileId === "string" ? body.profileId.trim() : "";
  const contractId = typeof body?.contractId === "string" ? body.contractId.trim() : "";
  const runIndex = typeof body?.runIndex === "number" ? body.runIndex : null;
  return probeResponse({ profileId, contractId, runIndex });
}
