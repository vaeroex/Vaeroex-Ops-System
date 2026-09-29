"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  isDarkSurface,
  normalizeThemePreference,
  resolveThemePreference,
  VAEROEX_THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference
} from "@/lib/theme/preferences";

type ThemeControlsProps = {
  variant?: "compact" | "panel";
};

const preferences: Array<{ value: ThemePreference; label: string; description: string }> = [
  {
    value: "pulsar",
    label: "Pulsar",
    description: "The flagship Vaeroex visual identity with premium signal accents."
  },
  {
    value: "system",
    label: "System",
    description: "Follow this device's current appearance setting."
  },
  {
    value: "light",
    label: "Light",
    description: "Bright executive workspace for users who prefer lighter surfaces."
  }
];

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(preference: ThemePreference) {
  const resolvedTheme = resolveThemePreference(preference, getSystemDark());
  const darkSurface = isDarkSurface(resolvedTheme);
  const root = document.documentElement;

  root.classList.toggle("dark", darkSurface);
  root.classList.toggle("pulsar", resolvedTheme === "pulsar");
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = darkSurface ? "dark" : "light";
  window.localStorage.setItem(VAEROEX_THEME_STORAGE_KEY, preference);
}

function resolvedThemeLabel(theme: ResolvedTheme) {
  return theme === "pulsar" ? "Pulsar" : "Light";
}

export function ThemeControls({ variant = "panel" }: ThemeControlsProps) {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [resolvedMode, setResolvedMode] = useState<ResolvedTheme>("pulsar");

  useEffect(() => {
    const initialPreference = normalizeThemePreference(window.localStorage.getItem(VAEROEX_THEME_STORAGE_KEY));
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const syncResolvedMode = (nextPreference: ThemePreference) => {
      setResolvedMode(resolveThemePreference(nextPreference, media.matches));
    };

    setPreference(initialPreference);
    applyTheme(initialPreference);
    syncResolvedMode(initialPreference);

    const handleSystemChange = () => {
      const current = normalizeThemePreference(window.localStorage.getItem(VAEROEX_THEME_STORAGE_KEY));
      applyTheme(current);
      syncResolvedMode(current);
    };

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  const updatePreference = (nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    applyTheme(nextPreference);
    setResolvedMode(resolveThemePreference(nextPreference, getSystemDark()));
  };

  if (variant === "compact") {
    return (
      <label className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100">
        <span className="hidden sm:inline">Theme</span>
        <select
          aria-label="Theme preference"
          value={preference}
          onChange={(event) => updatePreference(event.target.value as ThemePreference)}
          className="rounded-md border border-white/10 bg-vaeroex-navy px-2 py-1 text-xs font-semibold text-white outline-none hover:border-vaeroex-accent focus:border-vaeroex-accent"
        >
          {preferences.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const preferenceLabel = preferences.find((item) => item.value === preference)?.label ?? "Pulsar";

  return (
    <details className="workspace-secondary-details workspace-settings-appearance rounded-lg border border-vaeroex-silver bg-white p-4 dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-card sm:p-5">
      <summary className="cursor-pointer rounded-md text-ink outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue focus-visible:ring-offset-2">
        <span className="ml-1 inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 align-middle">
          <span className="text-base font-semibold">Appearance</span>
          <span className="text-sm text-muted">
            Current: {preferenceLabel}{preference === "system" ? ` · ${resolvedThemeLabel(resolvedMode)}` : ""}
          </span>
          <span className="text-sm font-semibold text-vaeroex-blue">Change theme</span>
        </span>
      </summary>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm text-muted">Theme settings are personal to this browser. Workspace access and account permissions remain unchanged.</p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3" aria-label="Theme choices">
          {preferences.map((item) => {
            const active = preference === item.value;
            const activeClass =
              item.value === "pulsar"
                ? "border-cyan-300/60 bg-[linear-gradient(135deg,rgba(37,99,235,0.16),rgba(124,58,237,0.18))] text-vaeroex-navy ring-2 ring-cyan-300/20 dark:text-white"
                : "border-vaeroex-blue bg-vaeroex-soft text-vaeroex-navy ring-2 ring-vaeroex-blue/15 dark:bg-white/10 dark:text-white";

            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => updatePreference(item.value)}
                className={`rounded-lg border p-4 text-left shadow-sm ${
                  active
                    ? activeClass
                    : "border-line bg-white text-ink hover:border-vaeroex-accent dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-secondary dark:text-vaeroex-dark-text"
                }`}
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-2 block text-sm leading-6 text-muted">{item.description}</span>
              </button>
            );
          })}
        </div>
        <details className="mt-4 rounded-lg border border-line p-3">
          <summary className="cursor-pointer rounded-md text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue focus-visible:ring-offset-2">Theme preview</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {[
              ["Business Health", "Executive scorecard surfaces stay high contrast."],
              ["Search and Intelligence", "Search locates records; Intelligence provides structured, evidence-backed analysis."],
              ["Pulsar", "Signal accents create the official Vaeroex visual experience without sacrificing readability."]
            ].map(([title, description]) => (
              <div key={title} className="rounded-lg border border-line bg-slate-50 p-4 dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-secondary">
                <p className="text-sm font-semibold text-vaeroex-blue">{title}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </div>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
