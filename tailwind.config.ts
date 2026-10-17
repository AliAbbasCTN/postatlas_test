import type { Config } from "tailwindcss";

// Design tokens. The legacy token names (ink, paper, line, verdigris, ...) are kept so every existing page keeps
// working; only their VALUES changed to the new palette. New semantic tokens: navy, accent*, mist, linestrong.
//   Navy #2D3E50 · Accent #FF7A59 · White #FFFFFF · Soft background #F5F8FA · Text #1F2937 · Secondary #64748B (rendered as #5E6E83 for AA contrast) · Border #E2E8F0
// Accessibility note: white text on #FF7A59 is only ~2.6:1, so coral buttons use dark text (`ink`, ~6:1), and coral is
// never used for small text. Coloured TEXT uses `accenttext` (#C2410C, ~5:1 on white).
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1F2937",
        inksoft: "#5E6E83", // spec #64748B darkened slightly: it measured 4.46:1 on #F5F8FA and 4.23:1 on chips (< 4.5:1 AA)
        paper: "#FFFFFF",
        paperdim: "#F5F8FA",
        line: "#E2E8F0",
        linestrong: "#CBD5E1",
        inputborder: "#8493A8", // 3.1:1 on white: form-field boundaries need 3:1 (WCAG 1.4.11)
        mist: "#EEF2F6",
        navy: "#2D3E50",
        navydark: "#22303F",
        accent: "#FF7A59",
        accentdark: "#F2663F",
        accentsoft: "#FFF1ED",
        accenttext: "#C2410C",
        // Success / verified green (kept under the old name because it is used for success states across the app).
        verdigris: "#1E7A55",
        verdigrisdark: "#14573C",
        amber: "#B45309",
        ambersoft: "#FDBA74",
        redsig: "#B42318"
      },
      fontFamily: {
        // `serif` is intentionally the sans stack: 128 existing headings use font-serif and now render in Inter.
        serif: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
      },
      fontWeight: { bold: "600" },
      borderRadius: { DEFAULT: "6px", md: "8px", lg: "10px", xl: "12px" },
      boxShadow: {
        card: "0 1px 2px rgba(31, 41, 55, 0.04)",
        pop: "0 8px 24px rgba(31, 41, 55, 0.12)"
      }
    }
  },
  plugins: []
};
export default config;
