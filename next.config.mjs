/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb"
    }
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
