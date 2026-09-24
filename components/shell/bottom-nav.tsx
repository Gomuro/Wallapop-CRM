"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, PlusIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

export function BottomNav() {
  const pathname = usePathname()
  const catalogActive = pathname === "/"
  const newItemActive = pathname === "/products/new"

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-lg border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
      <div className="grid w-full grid-cols-2 px-2 py-1">
        <Link
          href="/"
          aria-current={catalogActive ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "h-12 w-full flex-col gap-0.5",
          )}
        >
          <LayoutGridIcon
            className={catalogActive ? "text-primary" : "text-muted-foreground"}
          />
          <span
            className={cn(
              typeMeta,
              catalogActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            Catalog
          </span>
        </Link>
        <Link
          href="/products/new"
          aria-current={newItemActive ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "h-12 w-full flex-col gap-0.5",
          )}
        >
          <PlusIcon
            className={newItemActive ? "text-primary" : "text-muted-foreground"}
          />
          <span
            className={cn(
              typeMeta,
              newItemActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            New item
          </span>
        </Link>
      </div>
    </nav>
  )
}
