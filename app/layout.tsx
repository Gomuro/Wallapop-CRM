import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Plus_Jakarta_Sans } from "next/font/google"
import Script from "next/script"

import { AppShell } from "@/components/shell/app-shell"
import { THEME_COOKIE, THEME_INIT_SCRIPT } from "@/lib/theme-script"

import "./globals.css"

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "cyrillic-ext"],
  variable: "--font-plus-jakarta",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Wallapop CRM",
  description: "Inventario móvil para anuncios de Wallapop",
}

export const maxDuration = 30

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value
  return (
    <html
      lang="es-ES"
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body
        className={`${plusJakarta.variable} ${plusJakarta.className} min-h-full bg-background font-sans antialiased`}
        suppressHydrationWarning
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
