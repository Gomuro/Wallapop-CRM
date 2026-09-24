"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { LayoutGridIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ProductStatus } from "@/lib/validations"

const STATUS_FILTERS: { value: "ALL" | ProductStatus; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "SOLD", label: "Sold" },
  { value: "INACTIVE", label: "Inactive" },
]

function catalogHref(next: {
  q: string
  status: string
  view: "grid" | "list"
}) {
  const params = new URLSearchParams()
  if (next.q.trim()) params.set("q", next.q.trim())
  if (next.status && next.status !== "ALL") params.set("status", next.status)
  if (next.view === "list") params.set("view", "list")
  const query = params.toString()
  return query ? `/?${query}` : "/"
}

export function CatalogToolbar({
  q,
  status,
  view,
}: {
  q: string
  status: "ALL" | ProductStatus
  view: "grid" | "list"
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState(q)

  useEffect(() => {
    setDraft(q)
  }, [q])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === q) return
      startTransition(() => {
        router.replace(catalogHref({ q: draft, status, view }))
      })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [draft, q, router, status, view])

  function go(next: { q?: string; status?: string; view?: "grid" | "list" }) {
    startTransition(() => {
      router.replace(
        catalogHref({
          q: next.q ?? draft,
          status: next.status ?? status,
          view: next.view ?? view,
        }),
      )
    })
  }

  return (
    <header className="sticky top-0 z-30 space-y-3 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Catalog</h1>
        <div className="flex items-center gap-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => go({ view: "grid" })}
          >
            <LayoutGridIcon />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => go({ view: "list" })}
          >
            <ListIcon />
          </Button>
          <Drawer>
            <DrawerTrigger
              render={<Button variant="ghost" size="icon" />}
              aria-label="Filters"
            >
              <SlidersHorizontalIcon />
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Filter</DrawerTitle>
              </DrawerHeader>
              <div className="space-y-3 px-4 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor="drawer-search">Keyword</Label>
                  <Input
                    id="drawer-search"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="SKU or title"
                    className="h-11"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTERS.map((filter) => (
                    <Button
                      key={filter.value}
                      type="button"
                      size="sm"
                      variant={status === filter.value ? "default" : "outline"}
                      onClick={() => go({ status: filter.value })}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
              <DrawerFooter>
                <DrawerClose render={<Button className="w-full" size="lg" />}>
                  Apply
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search SKU or title"
        className="h-11"
        aria-label="Search catalog"
      />
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => go({ status: filter.value })}
            className="shrink-0"
          >
            <Badge variant={status === filter.value ? "default" : "outline"}>
              {filter.label}
            </Badge>
          </button>
        ))}
      </div>
      {pending ? (
        <p className="sr-only" aria-live="polite">
          Updating catalog
        </p>
      ) : null}
    </header>
  )
}
