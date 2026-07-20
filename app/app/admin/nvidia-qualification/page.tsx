import { notFound } from "next/navigation";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { getQualificationModelProfiles } from "@/lib/ai/qualification/profiles";
import { runStageOneQualificationProbe } from "@/lib/ai/qualification/stage-one";
import {
  QUALIFICATION_CONTRACT_IDS,
  type QualificationContractId
} from "@/lib/ai/qualification/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type QualificationPageProps = {
  searchParams?: Promise<{
    profileId?: string;
    contractId?: string;
    runIndex?: string;
  }>;
};

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_AI_SMOKE_TEST_ENABLED?.trim().toLowerCase() === "true";
}

export default async function NvidiaQualificationPage({ searchParams }: QualificationPageProps) {
  if (!enabled()) notFound();
  const access = await getVaeroexAdminAccess();
  if (!access.allowed) return <ErrorNotice message={access.error} />;
  const params = await searchParams;
  const profileId = params?.profileId?.trim() || "";
  const contractId = params?.contractId?.trim() || "";
  const runIndex = Number(params?.runIndex || "0");

  if (!profileId && !contractId) {
    return (
      <pre data-testid="qualification-metadata" className="overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify({
          benchmarkVersion: "nvidia_capability_stage_1_v1",
          profiles: getQualificationModelProfiles().map((profile) => ({
            id: profile.id,
            provider: profile.provider,
            model: profile.model,
            reasoningMode: profile.reasoningMode
          })),
          contracts: QUALIFICATION_CONTRACT_IDS,
          repetitions: 3,
          excluded: ["deep_strategic_analysis"]
        }, null, 2)}
      </pre>
    );
  }

  if (
    !getQualificationModelProfiles().some((profile) => profile.id === profileId)
    || !QUALIFICATION_CONTRACT_IDS.includes(contractId as QualificationContractId)
    || !Number.isInteger(runIndex)
    || runIndex < 1
    || runIndex > 3
  ) {
    return <ErrorNotice message="A valid Stage 1 profile, contract, and run index are required." />;
  }

  const result = await runStageOneQualificationProbe({
    profileId,
    contractId: contractId as QualificationContractId
  });
  console.log(JSON.stringify({
    level: "info",
    component: "nvidia-capability-qualification",
    event: "stage_one_page_probe",
    runIndex,
    ...result
  }));

  return (
    <pre data-testid="qualification-result" className="overflow-auto whitespace-pre-wrap text-xs">
      {JSON.stringify({ ok: true, runIndex, result }, null, 2)}
    </pre>
  );
}
