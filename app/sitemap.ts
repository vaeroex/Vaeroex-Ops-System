import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const publicPages = [
  "/",
  "/intelligence-systems",
  "/executive-intelligence",
  "/drug-discovery-intelligence",
  "/biological-intelligence",
  "/pricing",
  "/networking",
  "/trust",
  "/help",
  "/contact",
  "/demo",
  "/about",
  "/careers"
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return publicPages.map((path) => ({
    url: `${PUBLIC_SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/executive-intelligence" || path === "/drug-discovery-intelligence" || path === "/biological-intelligence" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/executive-intelligence" || path === "/drug-discovery-intelligence" || path === "/biological-intelligence" ? 0.9 : 0.7
  }));
}
