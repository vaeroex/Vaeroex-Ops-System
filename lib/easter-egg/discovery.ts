export const EASTER_EGG_SEARCH_PHRASE = "easter egg" as const;

export function normalizeEasterEggDiscoveryQuery(value: string | null | undefined) {
  return (value || "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

export function isEasterEggDiscoveryQuery(value: string | null | undefined) {
  return normalizeEasterEggDiscoveryQuery(value) === EASTER_EGG_SEARCH_PHRASE;
}
