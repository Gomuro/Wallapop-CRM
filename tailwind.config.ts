import type { Config } from "tailwindcss"

const oklch = (token: string) => `var(${token})`

const config: Config = {
  theme: {
    extend: {
      colors: {
        background: oklch("--background"),
        foreground: oklch("--foreground"),
        card: oklch("--card"),
        "card-foreground": oklch("--card-foreground"),
        popover: oklch("--popover"),
        "popover-foreground": oklch("--popover-foreground"),
        primary: oklch("--primary"),
        "primary-foreground": oklch("--primary-foreground"),
        secondary: oklch("--secondary"),
        "secondary-foreground": oklch("--secondary-foreground"),
        muted: oklch("--muted"),
        "muted-foreground": oklch("--muted-foreground"),
        accent: oklch("--accent"),
        "accent-foreground": oklch("--accent-foreground"),
        destructive: oklch("--destructive"),
        border: oklch("--border"),
        input: oklch("--input"),
        ring: oklch("--ring"),
      },
      fontFamily: {
        sans: ["var(--font-plus-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-plus-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
}

export default config
