import { SetupWizard } from "@/components/setup/SetupWizard";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { industryTemplates } from "@/data/industry-templates";
import { redirect } from "next/navigation";

type SetupPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      const status = await getSubscriptionStatus({
        supabase,
        userId: user.id,
        email: user.email
      });

      if (!status.allowed) {
        redirect(`/billing-required?reason=${encodeURIComponent(status.reason)}`);
      }
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Setup wizard</p>
        <h2 className="mt-2 text-2xl font-semibold">Create your operations intelligence workspace</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Answer a few setup questions, choose a business profile, and build the first layer of visibility, accountability, and execution structure.
          Vaeroex will then help surface risks, decisions, reports, and suggested next actions.
        </p>
      </section>
      <ComplianceNotice />
      <SetupWizard templates={industryTemplates} error={params?.error} />
    </div>
  );
}
