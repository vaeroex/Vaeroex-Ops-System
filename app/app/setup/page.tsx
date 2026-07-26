import { WorkspaceCreationForm } from "@/components/setup/WorkspaceCreationForm";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type SetupPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  let ownerName = "";
  let ownerEmail = "";

  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      ownerName = String(user.user_metadata?.full_name || "").trim();
      ownerEmail = user.email || "";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Executive Intelligence Workspace</p>
        <h1 className="mt-2 text-2xl font-semibold">Create your Vaeroex workspace</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Add the organization and accountable owner, review the Workspace Agreement, and sign electronically. Business context is added later through Evidence and Business Notes.
        </p>
      </section>
      <WorkspaceCreationForm defaultOwnerName={ownerName} defaultOwnerEmail={ownerEmail} error={params?.error} />
    </div>
  );
}
