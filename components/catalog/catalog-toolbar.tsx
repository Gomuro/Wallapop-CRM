"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { LayoutGridIcon, ListIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProductStatus } from "@/lib/validations"
import { typeMeta } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

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
    <header className="sticky top-0 z-30 space-y-3 border-b bg-background px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <h1 className="sr-only">Catalog</h1>
      <div className="relative w-full">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search SKU or title"
          className="h-11 w-full pr-2.5 !pl-9"
          aria-label="Search catalog"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS.map((filter) => {
            const active = status === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => go({ status: filter.value })}
                className={cn(
                  typeMeta,
                  "inline-flex h-11 shrink-0 items-center rounded-full px-3",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="icon"
          className="size-11"
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          onClick={() => go({ view: "grid" })}
        >
          <LayoutGridIcon />
        </Button>
        <Button
          variant={view === "list" ? "secondary" : "ghost"}
          size="icon"
          className="size-11"
          aria-label="List view"
          aria-pressed={view === "list"}
          onClick={() => go({ view: "list" })}
        >
          <ListIcon />
        </Button>
      </div>
      {pending ? (
        <p className="sr-only" aria-live="polite">
          Updating catalog
        </p>
      ) : null}
    </header>
  )
}
