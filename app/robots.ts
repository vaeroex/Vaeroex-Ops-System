import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api", "/login", "/signup", "/checkout", "/billing-required", "/admin"]
    },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
    host: PUBLIC_SITE_URL
  };
}
