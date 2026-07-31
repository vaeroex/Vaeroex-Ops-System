import { EasterEggExperience } from "@/components/easter-egg/EasterEggExperience";
import { loadEasterEggWorkspaceState } from "@/lib/easter-egg/data";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export const dynamic = "force-dynamic";

export default async function EasterEggPage() {
  const access = await requireWorkspaceAccess();
  const state = await loadEasterEggWorkspaceState(access.workspaceId);
  const canManageSettings = ["owner", "admin"].includes(access.membership.role);

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <header className="border-b border-line pb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-vaeroex-blue">You found it.</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold text-ink sm:text-4xl">Either you are determined to discover every Vaeroex feature, accidentally searched for an Easter egg, or are severely bored.</h1>
        <p className="mt-4 text-lg text-muted">So here you are. Try not to destroy company productivity.</p>
      </header>
      {state.error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{state.error}</p> : null}
      <EasterEggExperience
        initialHighScore={state.highScore}
        initialSettings={state.settings}
        leaderboard={state.leaderboard}
        canManageSettings={canManageSettings}
      />
    </div>
  );
}
