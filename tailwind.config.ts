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
        ink: "#0B1F4D",
        line: "#D1D5DB",
        muted: "#9CA3AF",
        vaeroex: {
          blue: "#1E6BFF",
          accent: "#38BDF8",
          navy: "#0B1F4D",
          silver: "#D1D5DB",
          "dark-silver": "#9CA3AF",
          soft: "#EAF4FF"
        }
      },
      boxShadow: {
        panel: "0 16px 42px rgba(11, 31, 77, 0.08)",
        command: "0 22px 70px rgba(11, 31, 77, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
