import type { Metadata } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { AppShell } from "@/components/shell/app-shell"
import { THEME_INIT_SCRIPT } from "@/lib/theme-script"

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-ES" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${plusJakarta.variable} ${plusJakarta.className} min-h-full bg-background font-sans antialiased`}
        suppressHydrationWarning
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
