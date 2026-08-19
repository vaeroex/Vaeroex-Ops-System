# CSP Enforcement Readiness

Vaeroex now enforces a compatibility-safe baseline on every route:

- `base-uri 'self'`
- `object-src 'none'`
- `frame-ancestors 'none'`
- `form-action 'self'` plus the approved Stripe origins
- `upgrade-insecure-requests`

The complete resource policy remains report-only by default and can be switched to enforcement with:

```text
VAEROEX_ENFORCE_CSP=true
```

Production `script-src` no longer permits `unsafe-eval`. Next.js development diagnostics retain it only when `NODE_ENV=development`; React and Next.js do not require it in production.

Keep the complete resource policy report-only until the following checks are completed against a representative Preview deployment:

- Stripe Checkout and Billing Portal continue to load and redirect correctly.
- Supabase Auth redirects, password recovery, and session refresh continue to work.
- Vercel Web Analytics or Speed Insights requests are either allowed or intentionally disabled.
- No public or authenticated route depends on an inline script that can be removed or replaced with a nonce.
- CSP violation reports have been reviewed for at least one normal public visit, login, checkout start, dashboard load, Ask Vaeroex run, file upload, and billing portal open.

Current known compromise:

- The policy still permits `unsafe-inline` for compatibility with statically rendered App Router output and the existing inline theme and structured-data scripts.
- Next.js nonce-based CSP requires dynamic rendering, disables static optimization and ISR, and changes CDN caching behavior. That architecture and performance change is intentionally outside this focused hardening pass.

Launch posture:

- The enforced baseline reduces navigation, embedding, and object-injection risk immediately without changing rendering.
- Full enforcement while retaining `unsafe-inline` improves resource controls but does not fully mitigate script injection.
- Enterprise readiness still requires a reviewed nonce or hash strategy, full CSP enforcement, and a documented violation-monitoring process.
