import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const publicPages = [
  "/",
  "/drug-discovery-intelligence",
  "/drug-discovery-intelligence/demo",
  "/networking",
  "/trust",
  "/contact",
  "/about",
  "/about/why-vaeroex",
  "/careers",
  "/support",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/subscription-billing-terms",
  "/workspace-capacity-terms",
  "/acceptable-use",
  "/sensitive-data-policy",
  "/data-retention",
  "/ai-disclaimer",
  "/human-review"
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return publicPages.map((path) => ({
    url: `${PUBLIC_SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/drug-discovery-intelligence" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/drug-discovery-intelligence") ? 0.9 : 0.7
  }));
}
