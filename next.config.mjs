import { createRequire } from "node:module";

const squareHandoffPolicy = createRequire(import.meta.url)("./lib/integrations/control-plane/square-customer-handoff-policy.json");

function securityHeaders() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const enforceFullCsp = process.env.VAEROEX_ENFORCE_CSP === "true";
  const scriptEvalSource = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const transportDirectives = process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [];
  const supabaseOrigin = (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).origin : "https://*.supabase.co";
    } catch {
      return "https://*.supabase.co";
    }
  })();
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com https://*.stripe.com",
    `script-src 'self' 'unsafe-inline'${scriptEvalSource} https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://checkout.stripe.com https://vitals.vercel-insights.com`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://challenges.cloudflare.com",
    ...transportDirectives
  ].join("; ");
  const enforcedBaselineCsp = [
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com https://*.stripe.com",
    ...transportDirectives
  ].join("; ");

  const cspHeaders = enforceFullCsp
    ? [{ key: "Content-Security-Policy", value: csp }]
    : [
        { key: "Content-Security-Policy", value: enforcedBaselineCsp },
        { key: "Content-Security-Policy-Report-Only", value: csp }
      ];

  return [
    ...cspHeaders,
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload"
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff"
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin"
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(self), clipboard-read=(self), clipboard-write=(self)"
    },
    {
      key: "X-Frame-Options",
      value: "DENY"
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin-allow-popups"
    }
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/app/setup": [
      "./public/fonts/NotoSans-Regular.ttf",
      "./public/fonts/NotoSans-Bold.ttf",
      "./public/brand/official/wordmark.png"
    ],
    "/api/stripe/webhook": ["./public/brand/official/wordmark.png"],
    "/app/admin/workspace-agreements": ["./public/brand/official/wordmark.png"],
    "/app/admin/workspace-agreements/**": ["./public/brand/official/wordmark.png"]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb"
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders()
      },
      // Authentication remains authoritative. Crawlers may read noindex even on redirects.
      ...["/executive-intelligence", "/operations-intelligence", "/pricing", "/release-notes", "/help", "/offline", "/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite", "/checkout/:path*", "/app/:path*", "/systems", "/access", "/billing-required", "/auth/:path*", "/admin/:path*"].map(source => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
      ...["/app/settings/storage/payment-return", "/api/storage-capacity/download"].map(source => ({
        // Configured headers take precedence over Route Handler headers. These
        // redirects can carry payment or signed-download credentials, so keep
        // their stricter policy after the global defaults.
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" }
        ]
      })),
      {
        // Next 15 preserves configured headers over Route Handler headers, and
        // custom header matching is case-insensitive. Keep the global policy,
        // then apply one fixed script hash even to case-variant not-found paths.
        source: "/api/integrations/square/:handoff(connect|reauthorize|callback)",
        headers: [
          { key: "Content-Security-Policy", value: squareHandoffPolicy.csp },
          { key: "Content-Security-Policy-Report-Only", value: squareHandoffPolicy.csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, max-age=0" }
        ]
      },
      {
        // Reporting OAuth starts use the same fixed navigation script as Square.
        // Keep the application-wide form-action restriction; only these three
        // standalone response documents receive the stricter hash-only policy.
        source: "/api/integrations/:provider(xero|harvest|zoho-inventory)/connect",
        headers: [
          { key: "Content-Security-Policy", value: squareHandoffPolicy.csp },
          { key: "Content-Security-Policy-Report-Only", value: squareHandoffPolicy.csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, max-age=0" }
        ]
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate"
          },
          {
            key: "Service-Worker-Allowed",
            value: "/"
          }
        ]
      }
    ];
  },
  async redirects() {
    return [
      { source: "/favicon.ico", destination: "/brand/official/favicon.ico", permanent: true },
      { source: "/favicon.png", destination: "/brand/official/icon-512.png", permanent: true },
      { source: "/icon-192.png", destination: "/brand/official/icon-192.png", permanent: true },
      { source: "/apple-touch-icon.png", destination: "/brand/official/apple-touch-icon.png", permanent: true },
      { source: "/brand/vaeroex-logo-white-wordmark.png", destination: "/brand/official/wordmark.png", permanent: true },
      { source: "/brand/drug-discovery-social.png", destination: "/brand/official/social.png", permanent: true },
      { source: "/operations-intelligence", destination: "/executive-intelligence", statusCode: 301 },
      { source: "/hourly-consulting", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/full-support-retainer", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/shop/p/hourly-consulting", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/shop/p/full-support-retainer", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/store/p/hourly-consulting", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/store/p/full-support-retainer", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/services/hourly-consulting", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/services/full-support-retainer", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/consulting", destination: "/contact?inquiry=custom-software", statusCode: 301 },
      { source: "/network", destination: "/networking", statusCode: 301 }
    ];
  }
};

export default nextConfig;
