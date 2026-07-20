import { notFound } from "next/navigation";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { STAGE_TWO_FIXTURES, getStageTwoFixtureMetadata } from "@/lib/ai/qualification/stage-two-fixtures";
import { STAGE_TWO_PROFILE_IDS, runStageTwoQualificationProbe } from "@/lib/ai/qualification/stage-two";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams?: Promise<{ profileId?: string; fixtureId?: string; runIndex?: string }>;
};

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

export default async function StageTwoQualificationPage({ searchParams }: PageProps) {
  if (!enabled()) notFound();
  const access = await getVaeroexAdminAccess();
  if (!access.allowed) return <ErrorNotice message={access.error} />;
  const params = await searchParams;
  const profileId = params?.profileId?.trim() || "";
  const fixtureId = params?.fixtureId?.trim() || "";
  const runIndex = Number(params?.runIndex || "0");

  if (!profileId && !fixtureId) {
    return (
      <pre data-testid="stage-two-metadata" className="overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify({
          benchmarkVersion: "nvidia_capability_stage_2_v1",
          profiles: STAGE_TWO_PROFILE_IDS,
          fixtures: getStageTwoFixtureMetadata(),
          repetitions: 4,
          executionsPerProfile: STAGE_TWO_FIXTURES.length * 4
        }, null, 2)}
      </pre>
    );
  }
  if (
    !STAGE_TWO_PROFILE_IDS.includes(profileId as (typeof STAGE_TWO_PROFILE_IDS)[number])
    || !STAGE_TWO_FIXTURES.some((fixture) => fixture.id === fixtureId)
    || !Number.isInteger(runIndex)
    || runIndex < 1
    || runIndex > 4
  ) {
    return <ErrorNotice message="A valid Stage 2 profile, fixture, and run index are required." />;
  }
  const result = await runStageTwoQualificationProbe({ profileId, fixtureId });
  const { blindOutput: _blindOutput, ...safeTelemetry } = result;
  console.log(JSON.stringify({
    level: "info",
    component: "nvidia-capability-qualification",
    event: "stage_two_page_probe",
    runIndex,
    ...safeTelemetry
  }));
  return (
    <pre data-testid="stage-two-result" className="overflow-auto whitespace-pre-wrap text-xs">
      {JSON.stringify({ ok: true, runIndex, result }, null, 2)}
    </pre>
  );
}
