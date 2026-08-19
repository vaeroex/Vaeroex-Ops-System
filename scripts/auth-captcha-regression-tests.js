const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const {
  AUTH_CAPTCHA_FIELD_NAME,
  resolveAuthCaptchaSubmission
} = require("../lib/auth/captcha.ts");

const captcha = read("lib/auth/captcha.ts");
const actions = read("lib/auth/actions.ts");
const widget = read("components/auth/AuthTurnstile.tsx");
const nextConfig = read("next.config.mjs");

for (const route of ["login", "signup", "forgot-password", "accept-invite"]) {
  const page = read(`app/(auth)/${route}/page.tsx`);
  assert.match(page, /<AuthTurnstile siteKey=\{getAuthCaptchaSiteKey\(\)\} \/>/, `${route} must mount the shared CAPTCHA widget`);
}

assert.match(captcha, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/, "CAPTCHA activation must remain environment-scoped");
assert.match(captcha, /if \(!siteKey\)[\s\S]{0,100}enabled: false/, "an unconfigured environment must preserve existing auth flows");
assert.match(captcha, /!token \|\| token\.length > MAX_TURNSTILE_TOKEN_LENGTH/, "missing and oversized tokens must fail closed when enabled");

const unconfiguredSubmission = resolveAuthCaptchaSubmission(new FormData(), undefined);
assert.deepEqual(unconfiguredSubmission, { enabled: false, token: undefined }, "an unconfigured environment must not require CAPTCHA");

const missingToken = new FormData();
assert.deepEqual(resolveAuthCaptchaSubmission(missingToken, "preview-site-key"), { enabled: true, token: null }, "a configured environment must reject a missing token");

const validToken = new FormData();
validToken.set(AUTH_CAPTCHA_FIELD_NAME, "verified-token");
assert.deepEqual(resolveAuthCaptchaSubmission(validToken, "preview-site-key"), { enabled: true, token: "verified-token" }, "a fresh token must be forwarded unchanged");

const oversizedToken = new FormData();
oversizedToken.set(AUTH_CAPTCHA_FIELD_NAME, "x".repeat(2049));
assert.deepEqual(resolveAuthCaptchaSubmission(oversizedToken, "preview-site-key"), { enabled: true, token: null }, "oversized token input must fail closed");

for (const errorPath of ["/login", "/signup", "/forgot-password", "/accept-invite"]) {
  assert.match(actions, new RegExp(`authCaptchaToken\\(formData, "${errorPath}"\\)`), `${errorPath} must verify a submitted CAPTCHA token before auth mutation`);
}

assert.match(actions, /signInWithPassword\(\{[\s\S]{0,120}options: \{ captchaToken \}/, "password login must forward the token to Supabase");
assert.match(actions, /signUp\(\{[\s\S]{0,260}captchaToken,[\s\S]{0,120}emailRedirectTo/, "account creation must forward the token to Supabase");
assert.match(actions, /resetPasswordForEmail\(email, \{[\s\S]{0,100}captchaToken,[\s\S]{0,120}redirectTo/, "password-reset initiation must forward the token to Supabase");
assert.equal((actions.match(/captchaToken,/g) || []).length, 3, "signup, invite acceptance, and reset initiation must use property token forwarding");
assert.match(actions, /updateUser\(\{ password \}\)/, "authenticated password updates must retain their session-bound path");

assert.match(widget, /api\.js\?render=explicit/, "Turnstile must use explicit rendering for the client component lifecycle");
assert.match(widget, /name=\{AUTH_CAPTCHA_FIELD_NAME\}/, "the verified token must be submitted through the auth form");
assert.match(widget, /"expired-callback": clearToken/, "expired tokens must be cleared");
assert.match(widget, /"error-callback": clearToken/, "failed challenges must not leave a stale token");
assert.match(widget, /"timeout-callback": clearToken/, "timed-out challenges must not leave a stale token");
assert.match(widget, /window\.turnstile\.remove\(widgetIdRef\.current\)/, "unmounted widgets must be cleaned up");

const turnstileCspAllowances = nextConfig.match(/https:\/\/challenges\.cloudflare\.com/g) || [];
assert.equal(turnstileCspAllowances.length, 2, "Turnstile must be allowed only by script-src and frame-src");
assert.match(nextConfig, /script-src[^\n]+https:\/\/challenges\.cloudflare\.com/, "Turnstile script loading must be CSP-compatible");
assert.match(nextConfig, /frame-src[^\n]+https:\/\/challenges\.cloudflare\.com/, "Turnstile challenge frames must be CSP-compatible");

const callback = read("app/auth/callback/route.ts");
assert.doesNotMatch(callback, /captcha|turnstile/i, "PKCE and OAuth callback exchange must remain independent of form CAPTCHA");

const resetPasswordPage = read("app/(auth)/reset-password/page.tsx");
assert.doesNotMatch(resetPasswordPage, /AuthTurnstile/, "a verified recovery session must not be challenged a second time during password update");

console.log("Auth CAPTCHA regression tests passed.");
