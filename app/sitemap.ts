import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const publicPages = [
  "/",
  "/operations-intelligence",
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
    changeFrequency: path === "/" || path === "/operations-intelligence" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/operations-intelligence" ? 0.9 : 0.7
  }));
}
