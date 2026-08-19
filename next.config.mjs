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
    `script-src 'self' 'unsafe-inline'${scriptEvalSource} https://js.stripe.com https://checkout.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://checkout.stripe.com https://vitals.vercel-insights.com`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://js.stripe.com https://checkout.stripe.com",
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
      "./public/fonts/NotoSans-Bold.ttf"
    ]
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
      { source: "/operations-intelligence", destination: "/executive-intelligence", statusCode: 301 },
      { source: "/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/shop/p/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/shop/p/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/store/p/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/store/p/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/services/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/services/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/consulting", destination: "/contact", statusCode: 301 },
      { source: "/network", destination: "/networking", statusCode: 301 }
    ];
  }
};

export default nextConfig;
