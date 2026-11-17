import { notFound } from "next/navigation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { VsiPreparationForm } from "@/components/vsi/VsiPreparationForm";

export default async function PreparationPage() {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.VAEROEX_VSI_PREPARATION) notFound();
  const { workspaceId, context } = await requireWorkspacePage();
  if (context.membership?.role !== "owner") notFound();
  return <VsiPreparationForm workspaceId={workspaceId} />;
}
