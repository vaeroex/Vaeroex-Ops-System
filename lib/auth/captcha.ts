export const AUTH_CAPTCHA_FIELD_NAME = "captcha_token";

const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

export type AuthCaptchaSubmission =
  | { enabled: false; token: undefined }
  | { enabled: true; token: string | null };

export function getAuthCaptchaSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;
}

export function resolveAuthCaptchaSubmission(
  formData: FormData,
  siteKey = getAuthCaptchaSiteKey()
): AuthCaptchaSubmission {
  if (!siteKey) {
    return { enabled: false, token: undefined };
  }

  const token = String(formData.get(AUTH_CAPTCHA_FIELD_NAME) || "").trim();

  if (!token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    return { enabled: true, token: null };
  }

  return { enabled: true, token };
}
