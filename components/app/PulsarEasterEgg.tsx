"use client";

import { Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  isDarkSurface,
  normalizeThemePreference,
  resolveThemePreference,
  VAEROEX_THEME_STORAGE_KEY,
  type ThemePreference
} from "@/lib/theme/preferences";

const hiddenPrefixes = ["/app", "/auth", "/api"] as const;
const hiddenPaths = new Set(["/login", "/signup", "/forgot-password", "/accept-invite", "/billing-required"]);
const publicPrefixes = ["/help"] as const;
const publicPaths = new Set([
  "/",
  "/about",
  "/acceptable-use",
  "/ai-disclaimer",
  "/contact",
  "/data-retention",
  "/demo",
  "/human-review",
  "/network",
  "/networking",
  "/pricing",
  "/privacy",
  "/refund-policy",
  "/release-notes",
  "/sensitive-data-policy",
  "/subscription-billing-terms",
  "/support",
  "/terms",
  "/trust"
]);

function shouldShowPulsarSignal(pathname: string) {
  if (hiddenPaths.has(pathname)) return false;
  if (hiddenPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (publicPaths.has(pathname)) return true;
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function applyThemePreference(preference: ThemePreference) {
  const resolvedTheme = resolveThemePreference(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  const darkSurface = isDarkSurface(resolvedTheme);
  const root = document.documentElement;

  root.classList.toggle("dark", darkSurface);
  root.classList.toggle("pulsar", resolvedTheme === "pulsar");
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = darkSurface ? "dark" : "light";
  window.localStorage.setItem(VAEROEX_THEME_STORAGE_KEY, preference);
}

export function PulsarEasterEgg() {
  const pathname = usePathname() || "/";
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const syncActiveState = () => {
      setActive(normalizeThemePreference(window.localStorage.getItem(VAEROEX_THEME_STORAGE_KEY)) === "pulsar");
    };

    setMounted(true);
    syncActiveState();
    window.addEventListener("storage", syncActiveState);
    return () => window.removeEventListener("storage", syncActiveState);
  }, []);

  if (!mounted || !shouldShowPulsarSignal(pathname)) {
    return null;
  }

  const activatePulsar = () => {
    applyThemePreference("pulsar");
    setActive(true);
    setOpen(false);
  };

  const returnToDark = () => {
    applyThemePreference(DEFAULT_THEME_PREFERENCE);
    setActive(false);
    setOpen(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="Signal Detected"
          className="mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-cyan-300/30 bg-slate-950/95 p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Experimental visual mode</p>
              <h2 className="mt-2 text-lg font-semibold">Signal Detected</h2>
            </div>
            <button
              type="button"
              aria-label="Close Pulsar signal panel"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/10 p-1.5 text-slate-300 hover:border-cyan-300/50 hover:text-white"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Pulsar Mode is an experimental visual layer inspired by deep-space intelligence systems.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={activatePulsar}
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.22)] hover:bg-fuchsia-200"
            >
              Activate Pulsar Mode
            </button>
            <button
              type="button"
              onClick={returnToDark}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-white/10"
            >
              Return to Dark Mode
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={open ? "Close Pulsar signal panel" : "Open Pulsar signal panel"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`vaeroex-pulsar-signal-button group grid h-11 w-11 place-items-center rounded-full border text-white shadow-[0_12px_38px_rgba(2,6,23,0.45)] backdrop-blur ${
          active ? "border-cyan-200/70 bg-cyan-300/20" : "border-white/15 bg-slate-950/75"
        }`}
      >
        <span className="vaeroex-pulsar-signal-dot" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 rounded-full border border-white/10 bg-slate-950/90 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Signal
        </span>
      </button>
    </div>
  );
}
