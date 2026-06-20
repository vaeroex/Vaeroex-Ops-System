import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://vaeroex.com"),
  title: "Vaeroex — Intelligence Platform",
  description: "Vaeroex is an Intelligence Platform for growing businesses. Operations Intelligence helps leaders improve visibility, accountability, execution, decision support, business memory, and operational performance.",
  openGraph: {
    title: "Vaeroex — Intelligence Platform",
    description: "Vaeroex is an Intelligence Platform for growing businesses. Operations Intelligence helps leaders improve visibility, accountability, execution, decision support, business memory, and operational performance.",
    siteName: "Vaeroex",
    type: "website",
    images: [
      {
        url: "/brand/vaeroex-logo-full.png",
        width: 1200,
        height: 630,
        alt: "Vaeroex"
      }
    ]
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: "/favicon.png"
  }
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
  return (
    <html lang="en" className="dark pulsar" data-theme="pulsar" data-theme-preference="pulsar" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
