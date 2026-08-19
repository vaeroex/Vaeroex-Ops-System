const AUTH_REDIRECT_BASE = "https://vaeroex.invalid";
const DEFAULT_AUTH_REDIRECT_PATH = "/app";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME_AFTER_SLASH = /^\/[a-z][a-z0-9+.-]*:/i;

function isSafeRelativeStage(value: string) {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !CONTROL_CHARACTERS.test(value) &&
    !SCHEME_AFTER_SLASH.test(value)
  );
}

export function safeAuthRedirectPath(value: string | null | undefined) {
  if (!value || value !== value.trim()) return DEFAULT_AUTH_REDIRECT_PATH;

  let decoded = value;
  for (let pass = 0; pass < 5; pass += 1) {
    if (!isSafeRelativeStage(decoded)) return DEFAULT_AUTH_REDIRECT_PATH;

    let nextDecoded: string;
    try {
      nextDecoded = decodeURIComponent(decoded);
    } catch {
      return DEFAULT_AUTH_REDIRECT_PATH;
    }

    if (nextDecoded === decoded) break;
    decoded = nextDecoded;
  }

  if (!isSafeRelativeStage(decoded) || decoded.includes("%")) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  try {
    const parsed = new URL(value, AUTH_REDIRECT_BASE);
    if (parsed.origin !== AUTH_REDIRECT_BASE || parsed.username || parsed.password) {
      return DEFAULT_AUTH_REDIRECT_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }
}
