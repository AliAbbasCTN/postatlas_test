import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F1A2B",
        inksoft: "#33425A",
        paper: "#F7F6F3",
        paperdim: "#EFEDE6",
        line: "#D8D3C7",
        verdigris: "#2F6E62",
        verdigrisdark: "#204F46",
        amber: "#C97A2B",
        ambersoft: "#F2AE72",
        redsig: "#A3402C"
      },
      fontFamily: {
        serif: ["'Source Serif 4'", "Georgia", "serif"],
        sans: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"]
      }
    }
  },
  plugins: []
};
export default config;
