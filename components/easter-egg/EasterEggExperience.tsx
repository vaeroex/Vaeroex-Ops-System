"use client";

import dynamic from "next/dynamic";
import { Loader2, Play, ShieldCheck, Trash2, Trophy } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEasterEggWorkspaceHistoryAction,
  startEasterEggRunAction,
  submitEasterEggRunAction,
  updateEasterEggLeaderboardSettingsAction
} from "@/app/app/easter-egg/actions";
import type { EasterEggLeaderboardEntry, EasterEggRunStart, EasterEggRunSubmission, EasterEggWorkspaceSettings } from "@/lib/easter-egg/contracts";

const EndlessRunnerGame = dynamic(() => import("@/components/easter-egg/EndlessRunnerGame"), {
  ssr: false,
  loading: () => <div className="grid aspect-[20/9] place-items-center rounded-md border border-cyan-300/25 bg-[#07111f] text-slate-300"><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span className="sr-only">Loading game</span></div>
});

type EasterEggExperienceProps = {
  initialHighScore: number;
  initialSettings: EasterEggWorkspaceSettings;
  leaderboard: EasterEggLeaderboardEntry[];
  canManageSettings: boolean;
};

export function EasterEggExperience({ initialHighScore, initialSettings, leaderboard, canManageSettings }: EasterEggExperienceProps) {
  const router = useRouter();
  const [run, setRun] = useState<EasterEggRunStart | null>(null);
  const [highScore, setHighScore] = useState(initialHighScore);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [settingsPending, startSettingsTransition] = useTransition();

  const startRun = useCallback(() => {
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await startEasterEggRunAction(crypto.randomUUID());
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setRun(result.data);
      setMessage("Run ready. The quarterly obstacle review begins now.");
    });
  }, [pending]);

  const finishRun = useCallback((result: Omit<EasterEggRunSubmission, "runId">) => {
    if (!run) return;
    startTransition(async () => {
      const submitted = await submitEasterEggRunAction({ runId: run.runId, ...result });
      if (!submitted.ok) {
        setMessage(submitted.message);
        return;
      }
      setHighScore(submitted.data.workspaceHighScore);
      setMessage(submitted.data.accepted ? `Valid score recorded: ${submitted.data.score.toLocaleString()}.` : "That score could not be validated, so it was not added to the leaderboard.");
      router.refresh();
    });
  }, [router, run]);

  function updateParticipation(formData: FormData) {
    if (settingsPending) return;
    const participate = formData.get("participate") === "on";
    const displayName = String(formData.get("display_name") || "");
    startSettingsTransition(async () => {
      const result = await updateEasterEggLeaderboardSettingsAction({ participate, displayName });
      setMessage(result.ok ? (participate ? "Public display name submitted for Vaeroex admin review." : "Public leaderboard participation turned off.") : result.message);
      if (result.ok) router.refresh();
    });
  }

  function deleteHistory(formData: FormData) {
    if (settingsPending) return;
    startSettingsTransition(async () => {
      const result = await deleteEasterEggWorkspaceHistoryAction(String(formData.get("confirmation") || ""));
      setMessage(result.ok ? `${result.data.deleted} private game run${result.data.deleted === 1 ? "" : "s"} deleted.` : result.message);
      if (result.ok) {
        setHighScore(0);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-700 bg-slate-950 p-4 shadow-xl shadow-slate-950/20 sm:p-6" aria-label="Easter Egg runner">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Workspace high score</p>
            <p className="mt-1 font-mono text-3xl font-bold text-white">{highScore.toLocaleString()}</p>
          </div>
          {!run ? (
            <button type="button" onClick={startRun} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-wait disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {pending ? "Starting..." : "Start run"}
            </button>
          ) : null}
        </div>
        {run ? <EndlessRunnerGame key={run.runId} run={run} onFinished={finishRun} onRestart={startRun} /> : (
          <div className="grid min-h-60 place-items-center rounded-md border border-dashed border-white/15 bg-[#07111f] p-8 text-center">
            <div>
              <Trophy className="mx-auto h-9 w-9 text-amber-300" aria-hidden="true" />
              <p className="mt-3 font-semibold text-white">A deeply serious test of executive reflexes</p>
              <p className="mt-1 text-sm text-slate-400">The run begins only when you choose Start.</p>
            </div>
          </div>
        )}
        {message ? <p className="mt-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200" role="status" aria-live="polite">{message}</p> : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
        <section aria-labelledby="leaderboard-title">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" />
            <h2 id="leaderboard-title" className="text-xl font-semibold text-ink">Public workspace leaderboard</h2>
          </div>
          <p className="mt-1 text-sm text-muted">Highest valid score per opted-in workspace. Ties share a rank; earlier scores appear first.</p>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {leaderboard.length ? leaderboard.map((entry, index) => (
              <li key={`${entry.rank}-${entry.displayName}-${index}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3">
                <span className="font-mono text-sm font-bold text-vaeroex-blue">#{entry.rank}{entry.tied ? " (tie)" : ""}</span>
                <span className="min-w-0 truncate font-semibold text-ink">{entry.displayName}</span>
                <span className="font-mono text-sm text-muted">{entry.score.toLocaleString()}</span>
                {index === 0 ? <span className="sr-only">Highest public score</span> : null}
              </li>
            )) : <li className="py-8 text-center text-sm text-muted">No workspaces have joined the public leaderboard yet.</li>}
          </ol>
        </section>

        <section aria-labelledby="game-settings-title" className="space-y-5 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-vaeroex-blue" aria-hidden="true" />
              <h2 id="game-settings-title" className="text-xl font-semibold text-ink">Hidden game settings</h2>
            </div>
            <p className="mt-1 text-sm text-muted">Public participation is off by default. Personal identity is never displayed.</p>
          </div>

          {canManageSettings ? (
            <form action={updateParticipation} className="space-y-3">
              <label className="flex items-start gap-3 text-sm text-ink">
                <input name="participate" type="checkbox" defaultChecked={initialSettings.publicParticipationRequested} className="mt-1 h-4 w-4 rounded border-line text-vaeroex-blue focus:ring-vaeroex-blue" />
                <span><strong>Join the public leaderboard</strong><span className="mt-1 block text-muted">Only an admin-approved workspace display name and highest valid score are shown.</span></span>
              </label>
              <label className="block text-sm font-semibold text-ink">
                Public workspace display name
                <input name="display_name" maxLength={48} defaultValue={initialSettings.publicDisplayName || ""} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 font-normal text-ink outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-blue/20" />
              </label>
              <p className="text-xs text-muted">Moderation: {initialSettings.moderationStatus === "none" ? "Not submitted" : initialSettings.moderationStatus}</p>
              <button type="submit" disabled={settingsPending} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue/30 disabled:cursor-wait disabled:opacity-60">{settingsPending ? "Saving..." : "Save game settings"}</button>
            </form>
          ) : <p className="text-sm text-muted">A workspace owner or admin can manage public leaderboard participation.</p>}

          {canManageSettings ? (
            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-ink">Delete private game history</summary>
              <form action={deleteHistory} className="mt-3 space-y-3">
                <p className="text-xs leading-5 text-muted">This permanently removes this workspace’s private game runs and high score. It does not affect any business data.</p>
                <input name="confirmation" placeholder="DELETE GAME HISTORY" aria-label="Type DELETE GAME HISTORY to confirm" className="min-h-11 w-full rounded-md border border-rose-200 px-3 py-2 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200" />
                <button type="submit" disabled={settingsPending} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete game history</button>
              </form>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}
