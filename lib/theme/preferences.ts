export type ThemePreference = "dark" | "light" | "system" | "pulsar";
export type ResolvedTheme = "dark" | "light" | "pulsar";

export const VAEROEX_THEME_STORAGE_KEY = "vaeroex-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system" || value === "pulsar";
}

export function normalizeThemePreference(value: string | null): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "pulsar") return "pulsar";
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function isDarkSurface(theme: ResolvedTheme) {
  return theme !== "light";
}
