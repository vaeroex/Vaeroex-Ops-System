# CSP Enforcement Readiness

Vaeroex now supports switching from `Content-Security-Policy-Report-Only` to enforced `Content-Security-Policy` with:

```text
VAEROEX_ENFORCE_CSP=true
```

Keep the default report-only mode until the following blockers are verified in production:

- Stripe Checkout and Billing Portal continue to load and redirect correctly.
- Supabase Auth redirects, password recovery, and session refresh continue to work.
- Vercel Web Analytics or Speed Insights requests are either allowed or intentionally disabled.
- No public or authenticated route depends on an inline script that can be removed or replaced with a nonce.
- No route requires `unsafe-eval` after dependency review.
- CSP violation reports have been reviewed for at least one normal public visit, login, checkout start, dashboard load, Ask Vaeroex run, file upload, and billing portal open.

Current known compromise:

- The policy still permits `unsafe-inline` and `unsafe-eval` for compatibility. Enforcement should not be considered complete until those are removed or narrowly replaced with nonces/hashes.

Launch posture:

- Report-only mode is acceptable for controlled SMB launch.
- Enforced CSP without removing `unsafe-inline` / `unsafe-eval` improves framing/resource controls but does not fully mitigate XSS.
- Enterprise readiness requires enforced CSP, no `unsafe-eval`, and a documented violation monitoring process.
