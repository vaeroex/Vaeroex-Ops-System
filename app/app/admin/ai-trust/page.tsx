import { AiTrustDashboard } from "@/components/admin/AiTrustDashboard";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { getAiTrustDashboardData } from "@/lib/admin/ai-trust-data";
import { parseAiTrustFilters } from "@/lib/admin/ai-trust-dashboard";
import { requireVaeroexAdmin } from "@/lib/security/require-vaeroex-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AiTrustPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AiTrustPage({ searchParams }: AiTrustPageProps) {
  const { admin } = await requireVaeroexAdmin("/app");
  const parsed = parseAiTrustFilters((await searchParams) || {});
  if (parsed.error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Internal admin" title="AI Trust" description="The requested dashboard filters were rejected safely." />
        <ErrorNotice message={parsed.error} />
      </div>
    );
  }
  const snapshot = await getAiTrustDashboardData({ admin, filters: parsed.filters });
  return <AiTrustDashboard snapshot={snapshot} filters={parsed.filters} />;
}
