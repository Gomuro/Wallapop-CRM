"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, PlusIcon, UserRoundIcon } from "lucide-react"

import { AuthUserMenu } from "@/components/auth/auth-user-menu"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function DesktopNav() {
  const pathname = usePathname()
  const catalogActive = pathname === "/"
  const newItemActive = pathname === "/products/new"
  const accountsActive =
    pathname === "/accounts" || pathname.startsWith("/accounts/")

  return (
    <header className="sticky top-0 z-40 hidden h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 md:flex md:px-8">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Wallapop CRM
      </Link>
      <nav className="flex items-center gap-1">
        <Link
          href="/"
          aria-current={catalogActive ? "page" : undefined}
          className={cn(
            buttonVariants({
              variant: catalogActive ? "secondary" : "ghost",
              size: "sm",
            }),
          )}
        >
          <LayoutGridIcon />
          Catálogo
        </Link>
        <Link
          href="/products/new"
          aria-current={newItemActive ? "page" : undefined}
          className={cn(
            buttonVariants({
              variant: newItemActive ? "default" : "ghost",
              size: "sm",
            }),
          )}
        >
          <PlusIcon />
          Subir producto
        </Link>
        <Link
          href="/accounts"
          aria-current={accountsActive ? "page" : undefined}
          className={cn(
            buttonVariants({
              variant: accountsActive ? "secondary" : "ghost",
              size: "sm",
            }),
          )}
        >
          <UserRoundIcon />
          Cuenta
        </Link>
        <ThemeToggle />
        <AuthUserMenu />
      </nav>
    </header>
  )
}
