import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { LegalAcceptanceGate } from "@/components/legal/LegalAcceptanceGate";
import { isVaeroexAdminEmail } from "@/lib/admin/admin-emails";
import { hasAcceptedLatestLegalPolicies } from "@/lib/legal/acceptance";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export default async function ProtectedAppLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
        <section className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-7 shadow-panel">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Configuration needed</p>
          <h1 className="mt-2 text-2xl font-semibold">Connect Supabase to continue</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to your environment before using
            authentication, workspace creation, or the Vaeroex setup wizard.
          </p>
        </section>
      </main>
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const context = await getWorkspaceContext(cookieStore.get("vaeroex_workspace_id")?.value);
  let notificationUnreadCount = 0;
  const isVaeroexAdmin = isVaeroexAdminEmail(user.email ?? context.profile?.email);
  const acceptedLatestPolicies = isVaeroexAdmin ? true : await hasAcceptedLatestLegalPolicies(supabase, user.id);

  if (context.activeWorkspace) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.activeWorkspace.id)
      .is("read_at", null)
      .is("archived_at", null)
      .is("deleted_at", null);

    notificationUnreadCount = count || 0;
  }

  return (
    <AppShell
      profile={context.profile}
      workspaces={context.workspaces}
      activeWorkspace={context.activeWorkspace}
      membership={context.membership}
      notificationUnreadCount={notificationUnreadCount}
    >
      {acceptedLatestPolicies ? (
        children
      ) : (
        <LegalAcceptanceGate userEmail={user.email ?? context.profile?.email} workspaceName={context.activeWorkspace?.name} />
      )}
    </AppShell>
  );
}
