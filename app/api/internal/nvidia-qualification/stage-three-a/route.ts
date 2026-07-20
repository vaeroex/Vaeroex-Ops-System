import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import {
  STAGE_THREE_A_FIXTURES,
  getStageThreeAFixtureMetadata
} from "@/lib/ai/qualification/stage-three-a-fixtures";
import {
  STAGE_THREE_A_PROFILE_IDS,
  runStageThreeAQualificationProbe
} from "@/lib/ai/qualification/stage-three-a";
import { STAGE_THREE_A_RETRIEVAL_PATHS } from "@/lib/ai/qualification/stage-three-a-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

async function requirePreviewAdmin() {
  if (!enabled()) {
    return noStore(NextResponse.json({ ok: false, error: "Qualification is unavailable." }, { status: 404 }));
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return noStore(NextResponse.json({ ok: false, error: "Sign in before running qualification." }, { status: 401 }));
  if (!isVaeroexAdminUser(user)) return noStore(NextResponse.json({ ok: false, error: "Vaeroex admin access is required." }, { status: 403 }));
  return null;
}

function validInput(profileId: string, fixtureId: string, retrievalPath: string, runIndex: number) {
  return STAGE_THREE_A_PROFILE_IDS.includes(profileId as (typeof STAGE_THREE_A_PROFILE_IDS)[number])
    && STAGE_THREE_A_FIXTURES.some((fixture) => fixture.id === fixtureId)
    && STAGE_THREE_A_RETRIEVAL_PATHS.includes(retrievalPath as (typeof STAGE_THREE_A_RETRIEVAL_PATHS)[number])
    && Number.isInteger(runIndex)
    && runIndex >= 1
    && runIndex <= 4;
}

async function execute(profileId: string, fixtureId: string, retrievalPath: string, runIndex: number) {
  if (!validInput(profileId, fixtureId, retrievalPath, runIndex)) {
    return noStore(NextResponse.json({ ok: false, error: "A valid Stage 3A profile, fixture, retrieval path, and run index are required." }, { status: 400 }));
  }
  const result = await runStageThreeAQualificationProbe({
    profileId,
    fixtureId,
    retrievalPath: retrievalPath as (typeof STAGE_THREE_A_RETRIEVAL_PATHS)[number]
  });
  const { blindOutput: _blindOutput, ...safeTelemetry } = result;
  console.log(JSON.stringify({
    level: "info",
    component: "nvidia-capability-qualification",
    event: "stage_three_a_probe",
    runIndex,
    ...safeTelemetry
  }));
  return noStore(NextResponse.json({ ok: true, runIndex, result }));
}

export async function GET(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId")?.trim() || "";
  const fixtureId = url.searchParams.get("fixtureId")?.trim() || "";
  const retrievalPath = url.searchParams.get("retrievalPath")?.trim() || "";
  const runIndexValue = url.searchParams.get("runIndex");
  if (profileId || fixtureId || retrievalPath || runIndexValue !== null) {
    return execute(profileId, fixtureId, retrievalPath, Number(runIndexValue));
  }
  return noStore(NextResponse.json({
    ok: true,
    benchmarkVersion: "nvidia_capability_stage_3a_v1",
    profiles: STAGE_THREE_A_PROFILE_IDS,
    retrievalPaths: STAGE_THREE_A_RETRIEVAL_PATHS,
    fixtures: getStageThreeAFixtureMetadata(),
    repetitions: 4,
    executionsPerProfile: STAGE_THREE_A_FIXTURES.length * STAGE_THREE_A_RETRIEVAL_PATHS.length * 4,
    totalExecutions: STAGE_THREE_A_PROFILE_IDS.length * STAGE_THREE_A_FIXTURES.length * STAGE_THREE_A_RETRIEVAL_PATHS.length * 4,
    totalJobDeadlineMs: 90_000,
    activeRetrievalChanged: false,
    excluded: ["executive_brief_v1", "deep_strategic_analysis", "production_routing"]
  }));
}

export async function POST(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  return execute(
    typeof body?.profileId === "string" ? body.profileId.trim() : "",
    typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "",
    typeof body?.retrievalPath === "string" ? body.retrievalPath.trim() : "",
    typeof body?.runIndex === "number" ? body.runIndex : 0
  );
}
