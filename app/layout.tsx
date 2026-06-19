import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaeroex Ops System",
  description: "A practical operations system for forms, checklists, SOPs, tasks, reports, and Vaeroex recommendations.",
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
