# Secrets Audit

| Secret | Where used | Client-safe or server-only | Status |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/config.ts` | Client-safe public Supabase URL | SAFE |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/config.ts` | Client-safe publishable/anon key; protected by RLS | SAFE |
| `NEXT_PUBLIC_APP_URL` | `lib/supabase/config.ts` | Client-safe app URL | SAFE |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts` | Server-only; file is marked `server-only` | SAFE |
| `OPENAI_API_KEY` | `lib/ai/vaeroex-client.ts` | Server-only; file is marked `server-only` | SAFE |
| `OPENAI_MODEL` | `lib/ai/vaeroex-client.ts` | Server-only runtime setting | SAFE |
| `CRON_SECRET` | `app/api/cron/report-subscriptions/route.ts` | Server-only route authorization secret | SAFE |
| `STRIPE_SECRET_KEY` | `lib/stripe/billing.ts` | Server-only Stripe API credential | SAFE |
| `STRIPE_WEBHOOK_SECRET` | `app/api/stripe/webhook/route.ts` | Server-only webhook verification secret | SAFE |
| `STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY` | `lib/stripe/billing.ts` | Server-only Stripe price identifier used to create Checkout sessions | SAFE |
| `SQUARESPACE_WEBHOOK_SECRET` | `app/api/squarespace/webhook/route.ts` | Server-only webhook verification secret | SAFE |
| `SQUARESPACE_API_KEY` | Documentation/config only in current repo | Server-only if implemented later | SAFE |
| `VAEROEX_ADMIN_EMAILS` | `lib/admin/admin-emails.ts` | Server-side admin allowlist | SAFE |

Checks performed:

- Client components are scanned by `scripts/security-check.ts` for server secret names.
- Client components must not import `@/lib/supabase/admin`.
- Client components must not import `@/lib/ai/vaeroex-client`.
- The service-role Supabase client and OpenAI runtime client are marked with `server-only`.

Important rule:

Never create `NEXT_PUBLIC_` versions of `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `CRON_SECRET`, or webhook secrets.
