import { notFound } from "next/navigation";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import {
  STAGE_THREE_A_FIXTURES,
  getStageThreeAFixtureMetadata
} from "@/lib/ai/qualification/stage-three-a-fixtures";
import {
  STAGE_THREE_A_PROFILE_IDS,
  runStageThreeAQualificationProbe
} from "@/lib/ai/qualification/stage-three-a";
import { STAGE_THREE_A_RETRIEVAL_PATHS } from "@/lib/ai/qualification/stage-three-a-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams?: Promise<{ profileId?: string; fixtureId?: string; retrievalPath?: string; runIndex?: string }>;
};

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

export default async function StageThreeAQualificationPage({ searchParams }: PageProps) {
  if (!enabled()) notFound();
  const access = await getVaeroexAdminAccess();
  if (!access.allowed) return <ErrorNotice message={access.error} />;
  const params = await searchParams;
  const profileId = params?.profileId?.trim() || "";
  const fixtureId = params?.fixtureId?.trim() || "";
  const retrievalPath = params?.retrievalPath?.trim() || "";
  const runIndex = Number(params?.runIndex || "0");

  if (!profileId && !fixtureId && !retrievalPath) {
    return (
      <pre data-testid="stage-three-a-metadata" className="overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify({
          benchmarkVersion: "nvidia_capability_stage_3a_v1",
          profiles: STAGE_THREE_A_PROFILE_IDS,
          retrievalPaths: STAGE_THREE_A_RETRIEVAL_PATHS,
          fixtures: getStageThreeAFixtureMetadata(),
          repetitions: 4,
          totalExecutions: STAGE_THREE_A_PROFILE_IDS.length * STAGE_THREE_A_FIXTURES.length * STAGE_THREE_A_RETRIEVAL_PATHS.length * 4
        }, null, 2)}
      </pre>
    );
  }
  if (
    !STAGE_THREE_A_PROFILE_IDS.includes(profileId as (typeof STAGE_THREE_A_PROFILE_IDS)[number])
    || !STAGE_THREE_A_FIXTURES.some((fixture) => fixture.id === fixtureId)
    || !STAGE_THREE_A_RETRIEVAL_PATHS.includes(retrievalPath as (typeof STAGE_THREE_A_RETRIEVAL_PATHS)[number])
    || !Number.isInteger(runIndex)
    || runIndex < 1
    || runIndex > 4
  ) {
    return <ErrorNotice message="A valid Stage 3A profile, fixture, retrieval path, and run index are required." />;
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
    event: "stage_three_a_page_probe",
    runIndex,
    ...safeTelemetry
  }));
  return (
    <pre data-testid="stage-three-a-result" className="overflow-auto whitespace-pre-wrap text-xs">
      {JSON.stringify({ ok: true, runIndex, result }, null, 2)}
    </pre>
  );
}
