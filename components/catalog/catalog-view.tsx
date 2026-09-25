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
        <div
          aria-busy={pending || undefined}
          className={cn(
            "transition-opacity duration-200 ease-out",
            pending && "pointer-events-none opacity-70",
          )}
        >
          {children}
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
