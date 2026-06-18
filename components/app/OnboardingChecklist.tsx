"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";

export type OnboardingChecklistItem = {
  id: string;
  title: string;
  helpText: string;
  href: string;
  completed: boolean;
  optional?: boolean;
};

type OnboardingChecklistProps = {
  workspaceId: string;
  items: OnboardingChecklistItem[];
  demoWorkspaceForm?: ReactNode;
  adminControls?: boolean;
  workspaceStatus?: string;
};

function storageKey(workspaceId: string) {
  return `vaeroex:onboarding:${workspaceId}:skipped`;
}

function readSkipped(workspaceId: string) {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    return new Set(JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) || "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

export function OnboardingChecklist({
  workspaceId,
  items,
  demoWorkspaceForm,
  adminControls = false,
  workspaceStatus = "Unknown"
}: OnboardingChecklistProps) {
  const [skipped, setSkipped] = useState<Set<string>>(() => readSkipped(workspaceId));
  const [hidden, setHidden] = useState(false);
  const [forceVisible, setForceVisible] = useState(false);
  const completedItemCount = items.filter((item) => item.completed).length;
  const completedCount = items.filter((item) => item.completed || skipped.has(item.id)).length;
  const skippedItems = items.filter((item) => skipped.has(item.id));
  const percentComplete = Math.round((completedCount / Math.max(items.length, 1)) * 100);
  const activeItems = useMemo(() => items.filter((item) => !item.completed && !skipped.has(item.id)), [items, skipped]);
  const shouldHideChecklist = hidden || percentComplete >= 100;
  const showChecklist = forceVisible || !shouldHideChecklist;

  if (!adminControls && !showChecklist) {
    return null;
  }

  function resetOnboarding() {
    const next = new Set<string>();
    setSkipped(next);
    setHidden(false);
    setForceVisible(true);
    window.localStorage.removeItem(storageKey(workspaceId));
  }

  function showOnboardingAgain() {
    setHidden(false);
    setForceVisible(true);
  }

  function hideChecklist() {
    setHidden(true);
    setForceVisible(false);
  }

  function skipItem(itemId: string) {
    const next = new Set(skipped);
    next.add(itemId);
    setSkipped(next);
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(Array.from(next)));
  }

  return (
    <section className="space-y-3">
      {adminControls ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Admin onboarding tools</p>
              <p className="mt-1 text-xs leading-5">
                Debug: onboarding {percentComplete}% | completed {completedItemCount}/{items.length} | skipped {skippedItems.length}
                {skippedItems.length ? ` (${skippedItems.map((item) => item.title).join(", ")})` : ""} | workspace status {workspaceStatus}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={resetOnboarding} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-amber-950">
                Reset onboarding
              </button>
              <button type="button" onClick={showOnboardingAgain} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-amber-950">
                Show onboarding checklist again
              </button>
              {demoWorkspaceForm}
            </div>
          </div>
        </div>
      ) : null}

      {showChecklist ? (
        <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-panel">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Guided onboarding</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Get Vaeroex useful in the first hour</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Complete the basics, skip what does not apply today, or explore a separate demo workspace with realistic business data.
              </p>
            </div>
            <div className="min-w-52 rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{percentComplete}% complete</p>
                <button type="button" onClick={hideChecklist} className="text-xs font-semibold text-muted underline">
                  Hide
                </button>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-vaeroex-blue" style={{ width: `${percentComplete}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {completedCount} of {items.length} steps complete or skipped.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {items.map((item) => {
              const isSkipped = skipped.has(item.id);
              const isDone = item.completed || isSkipped;

              return (
                <article key={item.id} className={`rounded-lg border p-4 ${isDone ? "border-emerald-100 bg-emerald-50" : "border-line bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {item.title}
                        {item.optional ? <span className="ml-2 text-xs font-medium text-muted">(optional)</span> : null}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted">{item.helpText}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isDone ? "bg-white text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                      {item.completed ? "Done" : isSkipped ? "Skipped" : "Next"}
                    </span>
                  </div>
                  {!isDone ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={item.href as Route} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
                        Start
                      </Link>
                      <button type="button" onClick={() => skipItem(item.id)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
                        Skip for now
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {!adminControls && activeItems.length ? (
            <div className="mt-5 flex flex-col gap-3 rounded-lg border border-line bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Want to see Vaeroex with data?</p>
                <p className="mt-1 text-sm leading-6 text-muted">The demo workspace is separate from customer workspaces and can be explored safely.</p>
              </div>
              {demoWorkspaceForm}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
