import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PulsarEasterEgg } from "@/components/app/PulsarEasterEgg";
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
    var stored = window.localStorage.getItem(key) || "dark";
    if (stored !== "light" && stored !== "dark" && stored !== "system" && stored !== "pulsar") {
      stored = "dark";
    }
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolvedTheme = stored === "pulsar" ? "pulsar" : stored === "system" ? (systemDark ? "dark" : "light") : stored;
    var darkSurface = resolvedTheme !== "light";
    var root = document.documentElement;
    root.classList.toggle("dark", darkSurface);
    root.classList.toggle("pulsar", resolvedTheme === "pulsar");
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = stored;
    root.style.colorScheme = darkSurface ? "dark" : "light";
  } catch (error) {
    var root = document.documentElement;
    root.classList.add("dark");
    root.classList.remove("pulsar");
    root.dataset.theme = "dark";
    root.dataset.themePreference = "dark";
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
    <html lang="en" className="dark" data-theme="dark" data-theme-preference="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <PulsarEasterEgg />
      </body>
    </html>
  );
}
