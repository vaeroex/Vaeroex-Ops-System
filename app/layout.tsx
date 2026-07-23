import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ActivityProvider } from "@/components/app/ActivityProvider";
import { PwaServiceWorker } from "@/components/app/PwaServiceWorker";
import { organizationJsonLd, PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || PUBLIC_SITE_URL),
  title: "Vaeroex Intelligence Systems | Executive Clarity",
  description: "Vaeroex builds intelligence systems that transform business information into visibility, awareness, prediction, and executive action.",
  openGraph: {
    title: "Vaeroex Intelligence Systems | Executive Clarity",
    description: "Vaeroex builds intelligence systems that transform business information into visibility, awareness, prediction, and executive action.",
    url: PUBLIC_SITE_URL,
    siteName: "Vaeroex Intelligence Systems",
    type: "website",
    images: [
      {
        url: "/brand/vaeroex-logo-white-wordmark.png",
        width: 1536,
        height: 1024,
        alt: "Vaeroex"
      }
    ]
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: "/favicon.png"
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Vaeroex",
    statusBarStyle: "black-translucent"
  },
  other: {
    "application-name": "Vaeroex",
    "apple-mobile-web-app-title": "Vaeroex",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "mobile-web-app-capable": "yes"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1220"
};

const themeScript = `
(function () {
  try {
    var key = "vaeroex-theme";
    var stored = window.localStorage.getItem(key) || "pulsar";
    if (stored === "dark") {
      stored = "pulsar";
    }
    if (stored !== "light" && stored !== "system" && stored !== "pulsar") {
      stored = "pulsar";
    }
    window.localStorage.setItem(key, stored);
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolvedTheme = stored === "system" ? (systemDark ? "pulsar" : "light") : stored;
    var darkSurface = resolvedTheme === "pulsar";
    var root = document.documentElement;
    root.classList.toggle("dark", darkSurface);
    root.classList.toggle("pulsar", resolvedTheme === "pulsar");
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = stored;
    root.style.colorScheme = darkSurface ? "dark" : "light";
  } catch (error) {
    var root = document.documentElement;
    root.classList.add("dark");
    root.classList.add("pulsar");
    root.dataset.theme = "pulsar";
    root.dataset.themePreference = "pulsar";
    root.style.colorScheme = "dark";
  }
})();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const organizationSchema = JSON.stringify(organizationJsonLd);

  return (
    <html lang="en" className="dark pulsar" data-theme="pulsar" data-theme-preference="pulsar" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationSchema }} />
      </head>
      <body>
        <ActivityProvider>
          <PwaServiceWorker />
          {children}
        </ActivityProvider>
      </body>
    </html>
  );
}
