import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import Link from "next/link";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/security/require-auth";
import { loadSystemAccess } from "@/lib/systems/access";
import { SystemsCatalog } from "@/components/systems/SystemsCatalog";
import { signOutAction } from "@/lib/auth/actions";
import { selectWorkspaceAction } from "@/lib/workspaces/actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Systems | Vaeroex", robots: { index: false, follow: false } };
export default async function YourSystemsPage() {
  const { supabase, user } = await requireAuth();
  const access = await loadSystemAccess(supabase, user);
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-800 bg-vaeroex-navy text-white"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5"><Link href="/" aria-label="Vaeroex home"><VaeroexLogo compact priority /></Link><form action={signOutAction}><button className="min-h-11 rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold focus-visible:outline">Sign out</button></form></div></header>
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-16">
      <SystemsCatalog decisions={access.decisions} needsWorkspaceSetup={access.needsWorkspaceSetup} />
      {access.workspaces.length > 0 ? <section aria-labelledby="system-workspaces" className="mt-10 rounded-2xl border border-slate-200 bg-white p-6"><h2 id="system-workspaces" className="text-xl font-semibold">Executive Intelligence workspaces</h2><p className="mt-2 text-sm leading-6 text-slate-600">Choose the workspace you want to open.</p><ul className="mt-5 grid gap-4 sm:grid-cols-2">{access.workspaces.map(workspace => <li key={workspace.id} className="rounded-lg border border-slate-200 p-4"><p className="font-semibold">{workspace.name}</p><p className="mt-1 text-sm text-slate-600">{workspace.allowed ? "Access active" : workspace.reason}</p>{workspace.allowed ? <form action={selectWorkspaceAction} className="mt-3"><input type="hidden" name="workspace_id" value={workspace.id} /><button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-offset-2">Open workspace</button></form> : <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline" href="/billing-required">Review access options</Link>}</li>)}</ul></section> : null}
    </div>
  </main>;
}
