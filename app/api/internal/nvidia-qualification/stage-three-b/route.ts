import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { auditStageThreeBOpenAIModelAccess } from "@/lib/ai/qualification/stage-three-b-generation";
import { STAGE_THREE_B_PROFILES, STAGE_THREE_B_PROFILE_IDS } from "@/lib/ai/qualification/stage-three-b-profiles";
import { runStageThreeBQualificationProbe } from "@/lib/ai/qualification/stage-three-b";
import { STAGE_THREE_B_ASSEMBLY_MODES, type StageThreeBAssemblyMode } from "@/lib/ai/qualification/stage-three-b-types";
import { STAGE_TWO_FIXTURES, getStageTwoFixtureMetadata } from "@/lib/ai/qualification/stage-two-fixtures";
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
  if (!enabled()) return noStore(NextResponse.json({ ok: false, error: "Qualification is unavailable." }, { status: 404 }));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) return noStore(NextResponse.json({ ok: false, error: "Sign in before running qualification." }, { status: 401 }));
  if (!isVaeroexAdminUser(user)) return noStore(NextResponse.json({ ok: false, error: "Vaeroex admin access is required." }, { status: 403 }));
  return null;
}

function validInput({
  profileId,
  fixtureId,
  runIndex,
  assemblyMode,
  phase
}: {
  profileId: string;
  fixtureId: string;
  runIndex: number;
  assemblyMode: string;
  phase: string;
}) {
  const profile = STAGE_THREE_B_PROFILES.find((item) => item.id === profileId);
  const fixture = STAGE_TWO_FIXTURES.find((item) => item.id === fixtureId);
  return Boolean(
    profile
    && fixture
    && profile.workflows[fixture.contractId]
    && STAGE_THREE_B_ASSEMBLY_MODES.includes(assemblyMode as StageThreeBAssemblyMode)
    && (assemblyMode === "one_pass" || profile.deterministicAssemblyEligible)
    && (phase === "compatibility" || phase === "qualification")
    && Number.isInteger(runIndex)
    && runIndex >= 1
    && runIndex <= (phase === "compatibility" ? 3 : 5)
  );
}

async function execute({
  profileId,
  fixtureId,
  runIndex,
  assemblyMode,
  phase
}: {
  profileId: string;
  fixtureId: string;
  runIndex: number;
  assemblyMode: string;
  phase: string;
}) {
  if (!validInput({ profileId, fixtureId, runIndex, assemblyMode, phase })) {
    return noStore(NextResponse.json({ ok: false, error: "A valid Stage 3B profile, fixture, assembly mode, phase, and run index are required." }, { status: 400 }));
  }
  const result = await runStageThreeBQualificationProbe({
    profileId,
    fixtureId,
    assemblyMode: assemblyMode as StageThreeBAssemblyMode
  });
  const { blindOutput: _blindOutput, ...safeTelemetry } = result;
  console.log(JSON.stringify({
    level: "info",
    component: "nvidia-capability-qualification",
    event: "stage_three_b_probe",
    phase,
    runIndex,
    ...safeTelemetry
  }));
  return noStore(NextResponse.json({ ok: true, phase, runIndex, result }));
}

export async function GET(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get("audit") === "openai_access") {
    const audits = await Promise.all([
      auditStageThreeBOpenAIModelAccess("gpt-5.6-terra"),
      auditStageThreeBOpenAIModelAccess("gpt-5.6-sol")
    ]);
    return noStore(NextResponse.json({ ok: true, benchmarkVersion: "executive_synthesis_stage_3b_v1", audits }));
  }
  const profileId = url.searchParams.get("profileId")?.trim() || "";
  const fixtureId = url.searchParams.get("fixtureId")?.trim() || "";
  const runIndexValue = url.searchParams.get("runIndex");
  if (profileId || fixtureId || runIndexValue !== null) {
    return execute({
      profileId,
      fixtureId,
      runIndex: Number(runIndexValue),
      assemblyMode: url.searchParams.get("assemblyMode")?.trim() || "one_pass",
      phase: url.searchParams.get("phase")?.trim() || "compatibility"
    });
  }
  return noStore(NextResponse.json({
    ok: true,
    benchmarkVersion: "executive_synthesis_stage_3b_v1",
    phases: ["compatibility", "qualification"],
    profiles: STAGE_THREE_B_PROFILES.map((profile) => ({
      id: profile.id,
      provider: profile.provider,
      requestedModel: profile.model,
      transport: profile.transport,
      workflows: Object.entries(profile.workflows).map(([contractId, settings]) => ({ contractId, ...settings })),
      deterministicAssemblyEligible: profile.deterministicAssemblyEligible
    })),
    profileIds: STAGE_THREE_B_PROFILE_IDS,
    fixtures: getStageTwoFixtureMetadata(),
    assemblyModes: STAGE_THREE_B_ASSEMBLY_MODES,
    workflowDeadlinesMs: {
      business_health_explanation_v1: 30_000,
      leadership_priorities_v1: 60_000,
      executive_brief_v1: 90_000
    },
    isolatedAttempts: 1,
    fallbackEnabled: false,
    activeRoutingChanged: false,
    excluded: ["deep_strategic_analysis", "production_routing", "active_reranking"]
  }));
}

export async function POST(request: Request) {
  const denied = await requirePreviewAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  return execute({
    profileId: typeof body?.profileId === "string" ? body.profileId.trim() : "",
    fixtureId: typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "",
    runIndex: typeof body?.runIndex === "number" ? body.runIndex : 0,
    assemblyMode: typeof body?.assemblyMode === "string" ? body.assemblyMode.trim() : "one_pass",
    phase: typeof body?.phase === "string" ? body.phase.trim() : "compatibility"
  });
}
