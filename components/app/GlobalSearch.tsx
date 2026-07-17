"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Command, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useActivitySignal } from "@/components/app/ActivityProvider";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import type { GlobalSearchGroup, GlobalSearchResponse } from "@/lib/search/types";

type GlobalSearchProps = {
  className?: string;
  variant?: "desktop" | "icon";
};

function flattenResults(groups: GlobalSearchGroup[]) {
  return groups.flatMap((group) => group.results);
}

export function GlobalSearch({ className = "", variant = "desktop" }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GlobalSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityBlocked, setSecurityBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestVersionRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const resultsId = useId();
  const titleId = useId();
  const trimmedQuery = query.trim();
  const indexedResults = useMemo(() => flattenResults(groups), [groups]);
  const isIconVariant = variant === "icon";
  useActivitySignal(loading, "Searching...", { source: "global-search", timeoutMs: 30_000 });

  const closeSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    requestVersionRef.current += 1;
    setLoading(false);
    setQuery("");
    setGroups([]);
    setSelectedIndex(-1);
    setError(null);
    setSecurityBlocked(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    function openSearch(nextQuery = "") {
      if (nextQuery) setQuery(nextQuery);
      setOpen(true);
    }

    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") closeSearch();
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
  }, [closeSearch]);

  useEffect(() => {
    if (searchParams.get("ask") === "1") {
      router.replace("/app/ask" as Route, { scroll: false });
      return;
    }
    if (searchParams.get("search") !== "1") return;

    setOpen(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("search");
    const nextQuery = nextParams.toString();
    router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}` as Route, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    if (trimmedQuery.length < 2) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      requestVersionRef.current += 1;
      setGroups([]);
      setSelectedIndex(-1);
      setError(null);
      setSecurityBlocked(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setSecurityBlocked(false);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(response.status === 401 ? "Sign in again to search Vaeroex." : "Vaeroex search is temporarily unavailable.");
        }

        const payload = (await response.json()) as GlobalSearchResponse;
        if (requestVersion !== requestVersionRef.current) return;
        if (payload.answer?.kind === "security_response") {
          setGroups([]);
          setSelectedIndex(-1);
          setSecurityBlocked(true);
          return;
        }
        const nextGroups = payload.groups || [];
        setGroups(nextGroups);
        setSelectedIndex(flattenResults(nextGroups).length ? 0 : -1);
      } catch (searchError) {
        if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
        setGroups([]);
        setSelectedIndex(-1);
        setSecurityBlocked(false);
        setError(searchError instanceof Error ? searchError.message : "Vaeroex search is temporarily unavailable.");
      } finally {
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
        if (!controller.signal.aborted && requestVersion === requestVersionRef.current) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (searchAbortRef.current === controller) searchAbortRef.current = null;
    };
  }, [open, trimmedQuery]);

  function openSelectedResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = indexedResults[selectedIndex];
    if (!selected) return;
    closeSearch();
    router.push(selected.href as Route);
  }

  function moveSelection(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!indexedResults.length || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setSelectedIndex((current) => {
      const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
      return (start + direction + indexedResults.length) % indexedResults.length;
    });
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setGroups([]);
    setSelectedIndex(-1);
    setError(null);
    setSecurityBlocked(false);
  }

  function clearQuery() {
    requestVersionRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setLoading(false);
    setQuery("");
    setGroups([]);
    setSelectedIndex(-1);
    setError(null);
    setSecurityBlocked(false);
    inputRef.current?.focus();
  }

  let flatIndex = -1;

  return (
    <div className={isIconVariant ? className : `${className || "w-full"} max-w-xl`}>
      <button
        type="button"
        className={isIconVariant
          ? "grid h-11 w-11 place-items-center rounded-lg border border-white/15 bg-white/10 text-slate-100 shadow-sm shadow-black/10 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
          : "hidden min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left text-sm font-medium text-slate-300 shadow-sm shadow-black/10 transition hover:border-vaeroex-accent/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 sm:flex"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Search Vaeroex"
      >
        {isIconVariant ? <Search className="h-4 w-4" aria-hidden="true" /> : (
          <>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-vaeroex-accent" aria-hidden="true" />
              <span className="truncate">Search</span>
            </span>
            <span className="hidden shrink-0 items-center gap-1 rounded-md border border-white/10 bg-slate-950/40 px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400 md:inline-flex">
              <Command className="h-3 w-3" aria-hidden="true" /> K
            </span>
          </>
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 px-3 py-4 sm:px-6 sm:py-8" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button type="button" className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" aria-label="Close Vaeroex search" onClick={closeSearch} />
          <section className="relative mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-vaeroex-accent/25 bg-[#07111f] text-slate-100 shadow-command sm:max-h-[min(82dvh,44rem)]">
            <header className="border-b border-white/10 bg-white/[0.045] p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Global Search</p>
                  <h2 id={titleId} className="mt-1 truncate text-base font-semibold text-white">Search</h2>
                </div>
                <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-slate-950/40 text-slate-300 hover:border-vaeroex-accent/45 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45" onClick={closeSearch} aria-label="Close search">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <label className="sr-only" htmlFor={inputId}>Search workspace records</label>
              <form className="relative mt-4" onSubmit={openSelectedResult} data-vaeroex-skip-global-activity>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-vaeroex-accent" aria-hidden="true" />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="search"
                  role="combobox"
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  onKeyDown={moveSelection}
                  placeholder="Search KPIs, evidence, reports, signals, or pages..."
                  autoComplete="off"
                  className="min-h-12 w-full rounded-lg border border-white/15 bg-slate-950/60 py-3 pl-10 pr-20 text-base font-medium text-white outline-none placeholder:text-slate-500 shadow-sm shadow-black/10 transition focus:border-vaeroex-accent/60 focus:bg-slate-950/75 focus:ring-2 focus:ring-vaeroex-accent/25"
                  aria-controls={resultsId}
                  aria-expanded={Boolean(indexedResults.length)}
                  aria-autocomplete="list"
                  aria-activedescendant={selectedIndex >= 0 ? `${resultsId}-option-${selectedIndex}` : undefined}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" /> : null}
                  {query ? (
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45" onClick={clearQuery} aria-label="Clear Vaeroex search">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </form>
            </header>

            <div id={resultsId} role="listbox" className="vaeroex-mobile-safe-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {securityBlocked ? (
                <SecurityResponseNotice compact />
              ) : trimmedQuery.length < 2 ? (
                <div className="border-l-2 border-vaeroex-accent/45 py-2 pl-4">
                  <p className="text-sm font-semibold text-white">Find a workspace record.</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Try a KPI, report title, source file, Business Signal, issue, or learned observation.</p>
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-400/30 bg-red-950/30 p-4 text-sm text-red-100" role="alert">{error}</div>
              ) : loading && !indexedResults.length ? (
                <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-300" role="status">
                  <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" /> Searching...
                </div>
              ) : indexedResults.length ? (
                <div className="space-y-3">
                  {groups.map((group) => (
                    <section key={group.label} className="border-b border-white/10 pb-3 last:border-b-0">
                      <div className="flex items-center justify-between gap-3 px-2 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{group.label}</p>
                        <span className="text-[0.68rem] font-semibold text-slate-400">{group.results.length}</span>
                      </div>
                      <div className="grid gap-1">
                        {group.results.map((result) => {
                          flatIndex += 1;
                          const currentIndex = flatIndex;
                          const selected = selectedIndex === currentIndex;
                          return (
                            <Link
                              id={`${resultsId}-option-${currentIndex}`}
                              role="option"
                              aria-selected={selected}
                              key={`${group.label}-${result.id}`}
                              href={result.href as Route}
                              className={`group rounded-lg border p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 ${selected ? "border-vaeroex-accent/45 bg-cyan-950/35" : "border-transparent hover:border-vaeroex-accent/35 hover:bg-cyan-950/25"}`}
                              onMouseEnter={() => setSelectedIndex(currentIndex)}
                              onFocus={() => setSelectedIndex(currentIndex)}
                              onClick={closeSearch}
                            >
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-white group-hover:text-vaeroex-accent">{result.title}</span>
                                <span className="rounded-full border border-white/10 bg-slate-950/45 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-300">{result.sourceType}</span>
                              </span>
                              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{result.preview}</span>
                              {result.meta ? <span className="mt-1 block text-[0.68rem] font-semibold text-slate-500">{result.meta}</span> : null}
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="border-l-2 border-white/15 py-2 pl-4">
                  <p className="text-sm font-semibold text-white">No matching workspace records found.</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Try a more specific title, KPI, file name, report, issue, or Business Signal.</p>
                </div>
              )}
            </div>

            <footer className="border-t border-white/10 bg-slate-950/45 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500 sm:px-4">
              Enter opens the selected result · Up and Down arrows move · Cmd/Ctrl + K opens Search
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
