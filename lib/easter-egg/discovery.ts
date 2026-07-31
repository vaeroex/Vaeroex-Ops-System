export const EASTER_EGG_SEARCH_PHRASES = Object.freeze([
  "easter egg",
  "easteregg",
  "secret game",
  "hidden game",
  "mini game",
  "minigame",
  "surprise me",
  "im bored",
  "i'm bored"
] as const);

export function normalizeEasterEggDiscoveryQuery(value: string | null | undefined) {
  return (value || "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

export function isEasterEggDiscoveryQuery(value: string | null | undefined) {
  const normalized = normalizeEasterEggDiscoveryQuery(value);
  return EASTER_EGG_SEARCH_PHRASES.some((phrase) => phrase === normalized);
}
