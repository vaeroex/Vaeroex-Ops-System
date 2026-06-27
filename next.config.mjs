/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb"
    }
  },
  async headers() {
    return [
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
      { source: "/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/shop/p/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/shop/p/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/store/p/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/store/p/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/services/hourly-consulting", destination: "/contact", statusCode: 301 },
      { source: "/services/full-support-retainer", destination: "/pricing", statusCode: 301 },
      { source: "/consulting", destination: "/contact", statusCode: 301 }
    ];
  }
};

export default nextConfig;
