"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, PlusIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function DesktopNav() {
  const pathname = usePathname()
  const catalogActive = pathname === "/"
  const newItemActive = pathname === "/products/new"

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
          Catalog
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
          New item
        </Link>
      </nav>
    </header>
  )
}
