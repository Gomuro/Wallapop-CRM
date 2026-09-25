import type { Metadata } from "next"
import { Plus_Jakarta_Sans } from "next/font/google"

import { AppShell } from "@/components/shell/app-shell"

import "./globals.css"

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "cyrillic"],
  variable: "--font-plus-jakarta",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Wallapop CRM",
  description: "Inventario móvil para anuncios de Wallapop",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-ES"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${plusJakarta.className} h-full antialiased`}
    >
      <body className={`${plusJakarta.className} min-h-full bg-background font-sans`} suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
