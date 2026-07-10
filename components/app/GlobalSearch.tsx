"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Command, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useActivitySignal } from "@/components/app/ActivityProvider";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import type { GlobalSearchAnswer, GlobalSearchGroup, GlobalSearchResponse } from "@/lib/search/types";

type GlobalSearchProps = {
  className?: string;
  variant?: "desktop" | "icon";
};

function resultCount(groups: GlobalSearchGroup[]) {
  return groups.reduce((count, group) => count + group.results.length, 0);
}

export function GlobalSearch({ className = "", variant = "desktop" }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GlobalSearchGroup[]>([]);
  const [answer, setAnswer] = useState<GlobalSearchAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const resultsId = useId();
  const titleId = useId();
  const trimmedQuery = query.trim();
  const total = useMemo(() => resultCount(groups), [groups]);
  const isIconVariant = variant === "icon";
  useActivitySignal(loading, "Searching...", { source: "global-search", timeoutMs: 20000 });

  useEffect(() => {
    function openSearch(nextQuery = "") {
      if (nextQuery) {
        setQuery(nextQuery);
      }
      setOpen(true);
    }

    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function handleGlobalSearchEvent(event: Event) {
      const detail = event instanceof CustomEvent ? (event.detail as { query?: string } | undefined) : undefined;
      openSearch(detail?.query || "");
    }

    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("vaeroex:open-global-search", handleGlobalSearchEvent);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("vaeroex:open-global-search", handleGlobalSearchEvent);
    };
  }, []);

  useEffect(() => {
    const shouldOpen = searchParams.get("search") === "1" || searchParams.get("ask") === "1";

    if (!shouldOpen) {
      return;
    }

    setOpen(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("search");
    nextParams.delete("ask");
    const nextQuery = nextParams.toString();
    router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}` as Route, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setGroups([]);
      setAnswer(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          throw new Error(response.status === 401 ? "Sign in again to search Vaeroex." : "Vaeroex search is temporarily unavailable.");
        }

        const payload = (await response.json()) as GlobalSearchResponse;
        setGroups(payload.groups || []);
        setAnswer(payload.answer || null);
      } catch (searchError) {
        if (controller.signal.aborted) {
          return;
        }

        setGroups([]);
        setAnswer(null);
        setError(searchError instanceof Error ? searchError.message : "Vaeroex search is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmedQuery]);

  return (
    <div className={isIconVariant ? className : `${className || "w-full"} max-w-xl`}>
      <button
        type="button"
        className={
          isIconVariant
            ? "grid h-11 w-11 place-items-center rounded-lg border border-white/15 bg-white/10 text-slate-100 shadow-sm shadow-black/10 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
            : "hidden min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left text-sm font-medium text-slate-300 shadow-sm shadow-black/10 transition hover:border-vaeroex-accent/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 sm:flex"
        }
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ask or search Vaeroex"
      >
        {isIconVariant ? (
          <Search className="h-4 w-4" aria-hidden="true" />
        ) : (
          <>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-vaeroex-accent" aria-hidden="true" />
              <span className="truncate">Ask or search...</span>
            </span>
            <span className="hidden shrink-0 items-center gap-1 rounded-md border border-white/10 bg-slate-950/40 px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400 md:inline-flex">
              <Command className="h-3 w-3" aria-hidden="true" /> K
            </span>
          </>
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 px-3 py-4 sm:px-6 sm:py-8" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            aria-label="Close Vaeroex search"
            onClick={() => setOpen(false)}
          />

          <section className="relative mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-vaeroex-accent/25 bg-[#07111f]/98 text-slate-100 shadow-command sm:max-h-[min(82dvh,44rem)]">
            <header className="border-b border-white/10 bg-white/[0.045] p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Global Search</p>
                  <h2 id={titleId} className="mt-1 truncate text-base font-semibold text-white">
                    Ask or Search
                  </h2>
                </div>
                <button
                  type="button"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-slate-950/40 text-slate-300 hover:border-vaeroex-accent/45 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                  onClick={() => setOpen(false)}
                  aria-label="Close search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <label className="sr-only" htmlFor={inputId}>
                Ask or search Vaeroex
              </label>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-vaeroex-accent" aria-hidden="true" />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ask a business question or search your workspace..."
                  autoComplete="off"
                  className="min-h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 py-3 pl-10 pr-16 text-base font-medium text-white outline-none placeholder:text-slate-500 shadow-sm shadow-black/10 transition focus:border-vaeroex-accent/60 focus:bg-slate-950/75 focus:ring-2 focus:ring-vaeroex-accent/25"
                  aria-controls={resultsId}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" /> : null}
                  {query ? (
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                      onClick={() => {
                        setQuery("");
                        setGroups([]);
                        setAnswer(null);
                        setError(null);
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear Vaeroex search"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            </header>

            <div id={resultsId} className="vaeroex-mobile-safe-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {trimmedQuery.length < 2 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
                  <p className="text-sm font-semibold text-white">Search your workspace or ask a business question.</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Try revenue, latest briefing, biggest risk, Business Health, or take me to my weakest KPI.</p>
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-400/30 bg-red-950/30 p-4 text-sm text-red-100">{error}</div>
              ) : loading && !total ? (
                <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" />
                  Searching Vaeroex...
                </div>
              ) : answer || total ? (
                <div className="space-y-3">
                  {answer?.kind === "security_response" ? (
                    <SecurityResponseNotice compact />
                  ) : answer ? (
                    <section className="rounded-xl border border-vaeroex-accent/25 bg-cyan-950/20 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Direct Answer</p>
                      <p className="mt-2 text-sm leading-6 text-white">{answer.directAnswer}</p>
                      {answer.recommendationConfidence ? (
                        <div className="mt-3 inline-flex rounded-full border border-white/10 bg-slate-950/45 px-3 py-1 text-xs font-semibold text-slate-100">
                          Recommendation Confidence: {answer.recommendationConfidence}
                        </div>
                      ) : null}
                      {answer.evidenceNote ? <p className="mt-3 text-xs leading-5 text-slate-300">{answer.evidenceNote}</p> : null}
                      {answer.relevantDestinations?.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {answer.relevantDestinations.map((destination) => (
                            <Link
                              key={`${destination.href}-${destination.label}`}
                              href={destination.href as Route}
                              className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-sm font-semibold text-white transition hover:border-vaeroex-accent/50 hover:bg-cyan-950/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                              onClick={() => setOpen(false)}
                            >
                              <span>{destination.label}</span>
                              {destination.context ? <span className="mt-1 block text-xs font-normal leading-5 text-slate-400">{destination.context}</span> : null}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {groups.map((group) => (
                    <section key={group.label} className="rounded-xl border border-white/10 bg-white/[0.045] p-2">
                      <div className="flex items-center justify-between gap-3 px-2 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{group.label}</p>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-300">{group.results.length}</span>
                      </div>
                      <div className="grid gap-1">
                        {group.results.map((result) => (
                          <Link
                            key={`${group.label}-${result.id}`}
                            href={result.href as Route}
                            className="group rounded-lg border border-transparent p-3 transition hover:border-vaeroex-accent/45 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                            onClick={() => setOpen(false)}
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white group-hover:text-vaeroex-accent">{result.title}</span>
                              <span className="rounded-full border border-white/10 bg-slate-950/45 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-300">
                                {result.sourceType}
                              </span>
                            </span>
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{result.preview}</span>
                            {result.meta ? <span className="mt-1 block text-[0.68rem] font-semibold text-slate-500">{result.meta}</span> : null}
                          </Link>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
                  <p className="text-sm font-semibold text-white">No matching workspace records found.</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Try a customer name, KPI, issue, report title, file name, or Business Signal.</p>
                </div>
              )}
            </div>

            <footer className="border-t border-white/10 bg-slate-950/45 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500 sm:px-4">
              Cmd/Ctrl + K opens Search or Ask anywhere in Vaeroex.
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
