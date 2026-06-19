import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        line: "#d7e0ec",
        muted: "#334155",
        vaeroex: {
          blue: "#2563eb",
          navy: "#0f172a",
          soft: "#eaf2ff"
        }
      },
      boxShadow: {
        panel: "0 16px 42px rgba(15, 23, 42, 0.08)",
        command: "0 22px 70px rgba(15, 23, 42, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
