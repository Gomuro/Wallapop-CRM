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
  const [syncedQ, setSyncedQ] = useState(q)
  const [requestedQ, setRequestedQ] = useState(q)

  if (q !== syncedQ) {
    setSyncedQ(q)
    if (q !== requestedQ) setDraft(q)
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nextQ = draft.trim()
      if (nextQ === q) return
      setRequestedQ(nextQ)
      startTransition(() => {
        router.replace(catalogHref({ q: draft, status, view }))
      })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [draft, q, router, status, view])

  function go(next: { q?: string; status?: string; view?: "grid" | "list" }) {
    const nextQ = (next.q ?? draft).trim()
    setRequestedQ(nextQ)
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
    <header className="sticky top-0 z-30 space-y-3 border-b bg-background px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:top-14 md:px-8">
      {pending ? (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary"
          aria-hidden="true"
        />
      ) : null}
      <h1 className="sr-only">Catalog</h1>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="relative w-full md:max-w-sm md:flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search SKU or title"
            className="h-11 w-full pr-2.5 !pl-9"
            aria-label="Search catalog"
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {STATUS_FILTERS.map((filter) => {
              const active = status === filter.value
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => go({ status: filter.value })}
                  className={cn(
                    typeMeta,
                    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {filter.label}
                </button>
              )
            })}
          </div>
          <div className="flex shrink-0 justify-end gap-1.5">
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
        </div>
      </div>
      {pending ? (
        <p className="sr-only" aria-live="polite">
          Updating catalog
        </p>
      ) : null}
    </header>
  )
}
