import { AuthMessage } from "@/components/auth/AuthMessage";
import { ThemeControls } from "@/components/app/ThemeControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { changePasswordAction } from "@/lib/auth/actions";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import Link from "next/link";
import { ArrowRight, Plug } from "lucide-react";

type SettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { context } = await requireWorkspacePage();

  return (
    <div className="workspace-page workspace-settings mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your account, workspace, and this browser’s appearance."
      />

      <section aria-labelledby="settings-integrations" className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="settings-integrations" className="flex items-center gap-2 text-lg font-semibold text-ink"><Plug aria-hidden="true" className="h-5 w-5" />Integrations</h2>
          <p className="mt-1 text-sm text-muted">Square and QuickBooks connections for this workspace.</p>
        </div>
        <Link href="/app/integrations" className="workspace-row-link inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue">
          Manage integrations<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>
      </section>

      <div className="workspace-settings-account-grid grid items-start gap-5 lg:grid-cols-2">
      <SectionCard
        title="Account"
        description={context.profile?.email || "Signed in to Vaeroex"}
      >
        <details open={Boolean(params?.error || params?.message)}>
          <summary className="w-fit cursor-pointer rounded-md py-1 text-sm font-semibold text-vaeroex-blue outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue focus-visible:ring-offset-2">Change password</summary>
          <form action={changePasswordAction} className="mt-4 max-w-xl space-y-4">
            <AuthMessage error={params?.error} message={params?.message} />
            <p className="text-sm text-muted">Use a strong password and update it only from a trusted device.</p>
            <label className="block text-sm font-medium text-ink">
              New password
              <input
                required
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Confirm password
              <input
                required
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
              />
            </label>
            <p className="text-xs leading-5 text-muted">
              Passwords must be at least 8 characters. Vaeroex will keep you signed in after a successful update.
            </p>
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
              Update password
            </button>
          </form>
        </details>
      </SectionCard>

      <SectionCard title="Workspace">
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Current workspace</dt>
            <dd className="mt-1 font-semibold text-ink">{context.activeWorkspace?.name || "Setup required"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Your role</dt>
            <dd className="mt-1 font-semibold text-ink">{context.membership?.role || "Setup pending"}</dd>
          </div>
        </dl>
      </SectionCard>
      </div>

      <ThemeControls />
    </div>
  );
}
