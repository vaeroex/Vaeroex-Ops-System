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
    var stored = window.localStorage.getItem(key) || "light";
    if (stored !== "light" && stored !== "dark" && stored !== "system") {
      stored = "light";
    }
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolvedDark = stored === "dark" || (stored === "system" && systemDark);
    var root = document.documentElement;
    root.classList.toggle("dark", resolvedDark);
    root.dataset.theme = resolvedDark ? "dark" : "light";
    root.dataset.themePreference = stored;
    root.style.colorScheme = resolvedDark ? "dark" : "light";
  } catch (error) {
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
