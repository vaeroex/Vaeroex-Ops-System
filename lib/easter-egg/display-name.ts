const DISALLOWED_NAME_TERMS = [
  "vaeroex",
  "administrator",
  "official",
  "support",
  "@",
  "http://",
  "https://",
  ".com"
];

export function normalizeEasterEggDisplayName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function validateEasterEggDisplayName(value: string) {
  const normalized = normalizeEasterEggDisplayName(value);
  if (normalized.length < 2 || normalized.length > 48) {
    return { valid: false as const, error: "Use a public workspace name between 2 and 48 characters." };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&.,+_-]*$/u.test(normalized)) {
    return { valid: false as const, error: "Use letters, numbers, spaces, and standard business-name punctuation only." };
  }
  const lower = normalized.toLocaleLowerCase("en-US");
  if (DISALLOWED_NAME_TERMS.some((term) => lower.includes(term))) {
    return { valid: false as const, error: "Choose a public name that cannot be mistaken for Vaeroex staff, support, or a web address." };
  }
  return { valid: true as const, value: normalized };
}
