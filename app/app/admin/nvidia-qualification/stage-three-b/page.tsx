import { notFound } from "next/navigation";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { STAGE_THREE_B_PROFILES } from "@/lib/ai/qualification/stage-three-b-profiles";
import { runStageThreeBQualificationProbe } from "@/lib/ai/qualification/stage-three-b";
import { STAGE_THREE_B_ASSEMBLY_MODES, type StageThreeBAssemblyMode } from "@/lib/ai/qualification/stage-three-b-types";
import { STAGE_TWO_FIXTURES, getStageTwoFixtureMetadata } from "@/lib/ai/qualification/stage-two-fixtures";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams?: Promise<{
    profileId?: string;
    fixtureId?: string;
    runIndex?: string;
    assemblyMode?: string;
    phase?: string;
  }>;
};

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

export default async function StageThreeBQualificationPage({ searchParams }: PageProps) {
  if (!enabled()) notFound();
  const access = await getVaeroexAdminAccess();
  if (!access.allowed) return <ErrorNotice message={access.error} />;
  const params = await searchParams;
  const profileId = params?.profileId?.trim() || "";
  const fixtureId = params?.fixtureId?.trim() || "";
  const runIndex = Number(params?.runIndex || "0");
  const assemblyMode = params?.assemblyMode?.trim() || "one_pass";
  const phase = params?.phase?.trim() || "compatibility";

  if (!profileId && !fixtureId) {
    return (
      <pre data-testid="stage-three-b-metadata" className="overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify({
          benchmarkVersion: "executive_synthesis_stage_3b_v1",
          profiles: STAGE_THREE_B_PROFILES.map((profile) => ({
            id: profile.id,
            provider: profile.provider,
            requestedModel: profile.model,
            transport: profile.transport,
            workflows: Object.keys(profile.workflows),
            deterministicAssemblyEligible: profile.deterministicAssemblyEligible
          })),
          fixtures: getStageTwoFixtureMetadata(),
          assemblyModes: STAGE_THREE_B_ASSEMBLY_MODES
        }, null, 2)}
      </pre>
    );
  }

  const profile = STAGE_THREE_B_PROFILES.find((item) => item.id === profileId);
  const fixture = STAGE_TWO_FIXTURES.find((item) => item.id === fixtureId);
  if (
    !profile
    || !fixture
    || !profile.workflows[fixture.contractId]
    || !STAGE_THREE_B_ASSEMBLY_MODES.includes(assemblyMode as StageThreeBAssemblyMode)
    || (assemblyMode === "deterministic_assembly" && !profile.deterministicAssemblyEligible)
    || (phase !== "compatibility" && phase !== "qualification")
    || !Number.isInteger(runIndex)
    || runIndex < 1
    || runIndex > (phase === "compatibility" ? 3 : 5)
  ) {
    return <ErrorNotice message="A valid Stage 3B profile, fixture, assembly mode, phase, and run index are required." />;
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
    event: "stage_three_b_page_probe",
    phase,
    runIndex,
    ...safeTelemetry
  }));
  return (
    <pre data-testid="stage-three-b-result" className="overflow-auto whitespace-pre-wrap text-xs">
      {JSON.stringify({ ok: true, phase, runIndex, result }, null, 2)}
    </pre>
  );
}
