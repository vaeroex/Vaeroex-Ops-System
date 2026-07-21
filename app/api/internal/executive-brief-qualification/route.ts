import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import {
  EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS,
  EXECUTIVE_BRIEF_QUALIFICATION_VERSION,
  getExecutiveBriefQualificationMetadata,
  runExecutiveBriefQualificationProbe,
  type ExecutiveBriefQualificationProfileId
} from "@/lib/ai/executive-brief/qualification";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

async function requirePreviewAdmin() {
  if (!enabled()) return noStore(NextResponse.json({ ok: false, error: "Qualification is unavailable." }, { status: 404 }));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return noStore(NextResponse.json({ ok: false, error: "Sign in before running qualification." }, { status: 401 }));
  if (!isVaeroexAdminUser(user)) return noStore(NextResponse.json({ ok: false, error: "Vaeroex admin access is required." }, { status: 403 }));
  return null;
}

export async function GET() {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  return noStore(NextResponse.json({
    ok: true,
    benchmarkVersion: EXECUTIVE_BRIEF_QUALIFICATION_VERSION,
    profiles: EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS,
    fixtures: getExecutiveBriefQualificationMetadata()
  }));
}

export async function POST(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {
    profileId?: string;
    fixtureId?: string;
    runIndex?: number;
    forceTerraFallback?: boolean;
  } | null;
  const profileId = body?.profileId?.trim() || "";
  const fixtureId = body?.fixtureId?.trim() || "";
  const runIndex = body?.runIndex;
  const forceTerraFallback = body?.forceTerraFallback === true;
  if (
    !EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS.includes(profileId as ExecutiveBriefQualificationProfileId)
    || !getExecutiveBriefQualificationMetadata().some((fixture) => fixture.id === fixtureId)
    || (forceTerraFallback && profileId !== "gpt56-sol")
    || !Number.isInteger(runIndex)
    || Number(runIndex) < 1
    || Number(runIndex) > 5
  ) {
    return noStore(NextResponse.json({ ok: false, error: "A valid profile, frozen fixture, and run index are required." }, { status: 400 }));
  }
  const result = await runExecutiveBriefQualificationProbe({
    profileId: profileId as ExecutiveBriefQualificationProfileId,
    fixtureId,
    forceTerraFallback
  });
  const { blindOutput: _blindOutput, ...safeTelemetry } = result;
  console.log(JSON.stringify({
    level: "info",
    component: "executive-brief-qualification",
    event: "frozen_fixture_probe",
    runIndex,
    ...safeTelemetry
  }));
  return noStore(NextResponse.json({ ok: true, runIndex, result }));
}
