"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-lg border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
      <div className="grid w-full grid-cols-2 px-2 py-1">
        <Button
          variant="ghost"
          size="lg"
          className="h-12 w-full flex-col gap-0.5 text-xs"
          nativeButton={false}
          render={<Link href="/" />}
          aria-current={pathname === "/" ? "page" : undefined}
        >
          <LayoutGridIcon
            className={pathname === "/" ? "text-primary" : "text-muted-foreground"}
          />
          <span className={pathname === "/" ? "text-primary" : "text-muted-foreground"}>
            Catalog
          </span>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="h-12 w-full flex-col gap-0.5 text-xs"
          nativeButton={false}
          render={<Link href="/products/new" />}
          aria-current={pathname === "/products/new" ? "page" : undefined}
        >
          <PlusIcon
            className={
              pathname === "/products/new" ? "text-primary" : "text-muted-foreground"
            }
          />
          <span
            className={
              pathname === "/products/new" ? "text-primary" : "text-muted-foreground"
            }
          >
            New item
          </span>
        </Button>
      </div>
    </nav>
  )
}
