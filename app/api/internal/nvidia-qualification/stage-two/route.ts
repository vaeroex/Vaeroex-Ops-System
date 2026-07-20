import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { STAGE_TWO_FIXTURES, getStageTwoFixtureMetadata } from "@/lib/ai/qualification/stage-two-fixtures";
import { STAGE_TWO_PROFILE_IDS, runStageTwoQualificationProbe } from "@/lib/ai/qualification/stage-two";
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

function validInput(profileId: string, fixtureId: string, runIndex: number) {
  return STAGE_TWO_PROFILE_IDS.includes(profileId as (typeof STAGE_TWO_PROFILE_IDS)[number])
    && STAGE_TWO_FIXTURES.some((fixture) => fixture.id === fixtureId)
    && Number.isInteger(runIndex)
    && runIndex >= 1
    && runIndex <= 4;
}

async function execute(profileId: string, fixtureId: string, runIndex: number) {
  if (!validInput(profileId, fixtureId, runIndex)) {
    return noStore(NextResponse.json({ ok: false, error: "A valid Stage 2 profile, fixture, and run index are required." }, { status: 400 }));
  }
  const result = await runStageTwoQualificationProbe({ profileId, fixtureId });
  const { blindOutput: _blindOutput, ...safeTelemetry } = result;
  console.log(JSON.stringify({
    level: "info",
    component: "nvidia-capability-qualification",
    event: "stage_two_probe",
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
  const runIndexValue = url.searchParams.get("runIndex");
  if (profileId || fixtureId || runIndexValue !== null) {
    return execute(profileId, fixtureId, Number(runIndexValue));
  }
  return noStore(NextResponse.json({
    ok: true,
    benchmarkVersion: "nvidia_capability_stage_2_v1",
    profiles: STAGE_TWO_PROFILE_IDS,
    fixtures: getStageTwoFixtureMetadata(),
    repetitions: 4,
    executionsPerProfile: STAGE_TWO_FIXTURES.length * 4,
    totalJobDeadlineMs: 90_000,
    excluded: ["biggest_risk_v1", "biggest_opportunity_v1", "review_changes_v1", "deep_strategic_analysis"]
  }));
}

export async function POST(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const profileId = typeof body?.profileId === "string" ? body.profileId.trim() : "";
  const fixtureId = typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "";
  const runIndex = typeof body?.runIndex === "number" ? body.runIndex : 0;
  return execute(profileId, fixtureId, runIndex);
}
