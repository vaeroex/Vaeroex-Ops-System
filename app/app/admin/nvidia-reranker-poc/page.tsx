import { notFound } from "next/navigation";
import { NvidiaRerankerPocRunner } from "@/components/admin/NvidiaRerankerPocRunner";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { nvidiaTextRerankerShadowEnabled } from "@/lib/ai/evidence-engine/nvidia-text-reranker";

export const dynamic = "force-dynamic";

export default async function NvidiaRerankerPocPage() {
  if (process.env.VERCEL_ENV !== "preview" || !nvidiaTextRerankerShadowEnabled()) notFound();
  const access = await getVaeroexAdminAccess();
  if (!access.allowed) return <ErrorNotice message={access.error} />;
  return <NvidiaRerankerPocRunner />;
}
