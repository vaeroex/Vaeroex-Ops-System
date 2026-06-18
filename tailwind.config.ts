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
        ink: "#0c1220",
        line: "#d8e1ec",
        muted: "#637084",
        vaeroex: {
          blue: "#0b5fff",
          navy: "#07172d",
          soft: "#eaf2ff"
        }
      },
      boxShadow: {
        panel: "0 18px 55px rgba(8, 23, 45, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
