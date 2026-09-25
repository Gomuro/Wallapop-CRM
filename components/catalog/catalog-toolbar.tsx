"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, type TransitionStartFunction } from "react"
import { LayoutGridIcon, ListIcon, SearchIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { StatusCounts } from "@/lib/inventory/types"
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

function stripLeadingWhitespace(value: string) {
  return value.replace(/^\s+/, "")
}

export function CatalogToolbar({
  q,
  status,
  view,
  counts,
  pending,
  startTransition,
}: {
  q: string
  status: "ALL" | ProductStatus
  view: "grid" | "list"
  counts: StatusCounts
  pending: boolean
  startTransition: TransitionStartFunction
}) {
  const router = useRouter()
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
      if (draft !== nextQ) setDraft(nextQ)
      if (nextQ === q) return
      setRequestedQ(nextQ)
      startTransition(() => {
        router.replace(catalogHref({ q: nextQ, status, view }))
      })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [draft, q, router, startTransition, status, view])

  function go(next: { q?: string; status?: string; view?: "grid" | "list" }) {
    const nextQ = (next.q ?? draft).trim()
    if (next.q !== undefined && draft !== nextQ) setDraft(nextQ)
    setRequestedQ(nextQ)
    startTransition(() => {
      router.replace(
        catalogHref({
          q: nextQ,
          status: next.status ?? status,
          view: next.view ?? view,
        }),
      )
    })
  }

  function clearSearch() {
    setDraft("")
    go({ q: "" })
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
            onChange={(event) =>
              setDraft(stripLeadingWhitespace(event.target.value))
            }
            onBlur={() => {
              const nextQ = draft.trim()
              if (nextQ !== draft) setDraft(nextQ)
            }}
            placeholder="Search SKU or title"
            className={cn("h-11 w-full !pl-9", draft ? "pr-11" : "pr-2.5")}
            aria-label="Search catalog"
          />
          {draft ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
              className="absolute top-1/2 right-1 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {STATUS_FILTERS.map((filter) => {
              const active = status === filter.value
              const count = counts[filter.value]
              const empty = filter.value !== "ALL" && count === 0
              return (
                <button
                  key={filter.value}
                  type="button"
                  disabled={empty && !active}
                  onClick={() => go({ status: filter.value })}
                  aria-pressed={active}
                  aria-label={`${filter.label}, ${count} items`}
                  className={cn(
                    typeMeta,
                    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-3 font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-foreground text-background"
                      : "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
                    empty && !active && "opacity-40",
                  )}
                >
                  {filter.label}
                  <span className="tabular-nums">({count})</span>
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
    </header>
  )
}
