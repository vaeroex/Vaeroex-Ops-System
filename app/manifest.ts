import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vaeroex",
    short_name: "Vaeroex",
    description: "Vaeroex Executive Intelligence",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0B1220",
    theme_color: "#0B1220",
    orientation: "portrait",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/favicon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
