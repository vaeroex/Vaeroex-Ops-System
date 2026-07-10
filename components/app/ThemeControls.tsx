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

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-vaeroex-silver bg-white p-5 shadow-panel dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Theme Settings</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Choose your Vaeroex appearance</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Pulsar is the default Vaeroex visual identity. System and Light remain available when you want them.
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-vaeroex-accent/40 bg-vaeroex-soft px-3 py-1 text-xs font-semibold text-vaeroex-blue dark:bg-white/10 dark:text-vaeroex-accent">
            Current: {resolvedThemeLabel(resolvedMode)}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
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
      </div>

      <div className="rounded-lg border border-vaeroex-silver bg-white p-5 shadow-panel dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-card">
        <p className="text-sm font-semibold text-ink">Premium Theme Preview</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[
            ["Business Health", "Executive scorecard surfaces stay high contrast."],
            ["Search or Ask", "Questions and workspace lookup share one calm entry point."],
            ["Pulsar", "Signal accents create the official Vaeroex visual experience without sacrificing readability."]
          ].map(([title, description]) => (
            <div key={title} className="rounded-lg border border-line bg-slate-50 p-4 dark:border-vaeroex-dark-border dark:bg-vaeroex-dark-secondary">
              <p className="text-sm font-semibold text-vaeroex-blue">{title}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
