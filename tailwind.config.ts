import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // MinTech Ethiopia brand: reddish brown + white
        clay: {
          50: "#fdf5f3",
          100: "#fbe8e3",
          200: "#f8d5cc",
          300: "#f2b6a8",
          400: "#e88c76",
          500: "#da674c",
          600: "#c64d30",
          700: "#a63d25",
          800: "#8a3622",
          900: "#733122",
          950: "#3e160d",
        },
        ink: "#2b1610",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Sora", "Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-up": "fadeUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fadeIn 0.5s ease both",
        shimmer: "shimmer 2.4s linear infinite",
        "pulse-ring": "pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        "scale-in": "scaleIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: {
          "0%": { backgroundPosition: "-700px 0" },
          "100%": { backgroundPosition: "700px 0" },
        },
        pulseRing: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(198, 77, 48, 0.45)" },
          "50%": { boxShadow: "0 0 0 10px rgba(198, 77, 48, 0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
