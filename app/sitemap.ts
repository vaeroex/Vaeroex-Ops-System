import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const publicPages = [
  "/",
  "/executive-intelligence",
  "/drug-discovery-intelligence",
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
    changeFrequency: path === "/" || path === "/executive-intelligence" || path === "/drug-discovery-intelligence" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/executive-intelligence" || path === "/drug-discovery-intelligence" ? 0.9 : 0.7
  }));
}
