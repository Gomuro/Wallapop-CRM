"use client"

import { useTransition, type ReactNode } from "react"

import { CatalogToolbar } from "@/components/catalog/catalog-toolbar"
import { PageContainer } from "@/components/shell/page-container"
import type { StatusCounts } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"
import { cn } from "@/lib/utils"

export function CatalogView({
  q,
  status,
  view,
  counts,
  children,
}: {
  q: string
  status: "ALL" | ProductStatus
  view: "grid" | "list"
  counts: StatusCounts
  children: ReactNode
}) {
  const [pending, startTransition] = useTransition()

  return (
    <>
      <CatalogToolbar
        q={q}
        status={status}
        view={view}
        counts={counts}
        pending={pending}
        startTransition={startTransition}
      />
      <PageContainer className="flex-1 py-3">
        <div className="relative">
          <div
            aria-busy={pending || undefined}
            className={cn(
              "transition-opacity duration-200 ease-out",
              pending && "pointer-events-none opacity-50",
            )}
          >
            {children}
          </div>
          {pending ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 z-10 grid animate-pulse gap-4 bg-background/70 p-0",
                view === "list"
                  ? "grid-cols-1"
                  : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
              )}
              aria-hidden="true"
            >
              {Array.from({ length: view === "list" ? 3 : 4 }, (_, index) => (
                <div
                  key={index}
                  className={
                    view === "list"
                      ? "h-24 rounded-xl bg-muted"
                      : "aspect-square rounded-xl bg-muted"
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
        {pending ? (
          <p className="sr-only" aria-live="polite">
            Actualizando catálogo
          </p>
        ) : null}
      </PageContainer>
    </>
  )
}
