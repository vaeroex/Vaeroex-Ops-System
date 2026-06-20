export type ThemePreference = "pulsar" | "system" | "light";
export type ResolvedTheme = "pulsar" | "light";

export const VAEROEX_THEME_STORAGE_KEY = "vaeroex-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "pulsar";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "pulsar" || value === "system" || value === "light";
}

export function normalizeThemePreference(value: string | null): ThemePreference {
  if (value === "dark") return DEFAULT_THEME_PREFERENCE;
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "pulsar" : "light";
  return preference;
}

export function isDarkSurface(theme: ResolvedTheme) {
  return theme === "pulsar";
}
