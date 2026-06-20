"use client";

import { useEffect, useState } from "react";

type ThemePreference = "light" | "dark" | "system";
type ThemeControlsProps = {
  variant?: "compact" | "panel";
};

const storageKey = "vaeroex-theme";
const preferences: Array<{ value: ThemePreference; label: string; description: string }> = [
  {
    value: "dark",
    label: "Dark Mode",
    description: "Premium intelligence workspace for long working sessions."
  },
  {
    value: "light",
    label: "Light Mode",
    description: "Bright executive workspace for users who prefer lighter surfaces."
  },
  {
    value: "system",
    label: "System Default",
    description: "Follow this device's current appearance setting."
  }
];

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function resolveTheme(preference: ThemePreference) {
  return preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function applyTheme(preference: ThemePreference) {
  const isDark = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.toggle("dark", isDark);
  root.dataset.theme = isDark ? "dark" : "light";
  root.dataset.themePreference = preference;
  root.style.colorScheme = isDark ? "dark" : "light";
  window.localStorage.setItem(storageKey, preference);
}

export function ThemeControls({ variant = "panel" }: ThemeControlsProps) {
  const [preference, setPreference] = useState<ThemePreference>("dark");
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const initialPreference = isThemePreference(stored) ? stored : "dark";
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const syncResolvedMode = (nextPreference: ThemePreference) => {
      const isDark = nextPreference === "dark" || (nextPreference === "system" && media.matches);
      setResolvedMode(isDark ? "dark" : "light");
    };

    setPreference(initialPreference);
    applyTheme(initialPreference);
    syncResolvedMode(initialPreference);

    const handleSystemChange = () => {
      const current = (window.localStorage.getItem(storageKey) || "dark") as ThemePreference;
      if (isThemePreference(current)) {
        applyTheme(current);
        syncResolvedMode(current);
      }
    };

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  const updatePreference = (nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    applyTheme(nextPreference);
    setResolvedMode(resolveTheme(nextPreference) ? "dark" : "light");
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
              {item.label.replace(" Mode", "")}
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
              Dark mode is the default Vaeroex experience. Light mode and system preference remain available when you want them.
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-vaeroex-accent/40 bg-vaeroex-soft px-3 py-1 text-xs font-semibold text-vaeroex-blue dark:bg-white/10 dark:text-vaeroex-accent">
            Current: {resolvedMode === "dark" ? "Dark" : "Light"}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {preferences.map((item) => {
            const active = preference === item.value;

            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => updatePreference(item.value)}
                className={`rounded-lg border p-4 text-left shadow-sm ${
                  active
                    ? "border-vaeroex-blue bg-vaeroex-soft text-vaeroex-navy ring-2 ring-vaeroex-blue/15 dark:bg-white/10 dark:text-white"
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
        <p className="text-sm font-semibold text-ink">Dark Mode Preview</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[
            ["Business Health", "Executive scorecard surfaces stay high contrast."],
            ["Ask Vaeroex", "Recommendations read like an intelligence center."],
            ["Reports and KPIs", "Charts retain Vaeroex Blue and Electric Blue series."]
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
