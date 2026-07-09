import { createSupportRequestAction } from "@/app/support/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type AppSupportPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function AppSupportPage({ searchParams }: AppSupportPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const context = await getWorkspaceContext();
  const {
    data: { user }
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Support"
        title="Contact Vaeroex support"
        description="Send account, subscription, workspace, or Vaeroex result questions to the support queue."
      />
      {params?.message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
      <ErrorNotice message={params?.error} />

      <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 text-sm leading-6 text-muted md:grid-cols-2">
        <p>
          Support questions:{" "}
          <a href={VAEROEX_MAILTO_LINKS.support} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            {VAEROEX_CONTACT_EMAILS.support}
          </a>
        </p>
        <p>
          Billing, subscription, or payment questions:{" "}
          <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            {VAEROEX_CONTACT_EMAILS.billing}
          </a>
        </p>
      </div>

      <SectionCard title="Support request">
        <form action={createSupportRequestAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="return_path" value="/app/support" />
          <input type="hidden" name="workspace_id" value={context.activeWorkspace?.id || ""} />
          <TextInput label="Name" name="name" required defaultValue={context.profile?.full_name || user?.user_metadata?.full_name || ""} />
          <TextInput label="Email" name="email" type="email" required defaultValue={context.profile?.email || user?.email || ""} />
          <TextInput label="Workspace" name="workspace" defaultValue={context.activeWorkspace?.name || ""} placeholder="Workspace name or ID" />
          <TextInput label="Page/module" name="page_module" placeholder="Dashboard, Files, Reports, Billing..." />
          <SelectInput label="Issue type" name="issue_type" required options={["Subscription access", "Workspace setup", "Vaeroex result", "Bug or error", "Billing question", "Other"]} />
          <SelectInput label="Priority" name="priority" required defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
          <div className="md:col-span-2">
            <TextArea label="Message" name="message" required rows={6} />
            <p className="mt-2 text-xs leading-5 text-muted">
              Do not include patient data, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data. Screenshots can be sent by email if Vaeroex support requests them.
            </p>
          </div>
          <div className="md:col-span-2">
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Send support request</button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
