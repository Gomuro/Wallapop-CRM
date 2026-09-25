"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import {
  updateProductListingAction,
  type ListingActionState,
} from "@/app/actions/listing"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { listingStatusLabel } from "@/lib/inventory/format"
import type { InventoryListing } from "@/lib/inventory/types"
import type { ListingStatus } from "@/lib/validations"
import { typeSection } from "@/lib/ui/type"

const LISTING_STATUS_OPTIONS: ListingStatus[] = [
  "READY_TO_POST",
  "ACTIVE",
  "DEACTIVATED",
]

export function ListingFields({
  productId,
  listing,
}: {
  productId: string
  listing: InventoryListing | null
}) {
  const router = useRouter()
  const action = updateProductListingAction.bind(null, productId)
  const [state, formAction, pending] = useActionState(action, {} as ListingActionState)
  const [status, setStatus] = useState<ListingStatus>(
    listing?.status ?? "READY_TO_POST",
  )

  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const target =
      (key ? document.getElementById(key) : null) ??
      document.getElementById("listing-form-error")
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state])

  useEffect(() => {
    if (listing?.status) setStatus(listing.status)
  }, [listing?.status])

  useEffect(() => {
    if (state.success) router.refresh()
  }, [state.success, router])

  if (!listing) {
    return (
      <Card className="gap-3 overflow-visible py-3 shadow-none">
        <CardHeader className="px-3">
          <h2 className={typeSection}>Anuncio en Wallapop</h2>
        </CardHeader>
        <CardContent className="px-3">
          <p className="text-sm text-muted-foreground">
            La cuenta de Wallapop no está configurada. El anuncio aparecerá cuando se complete la configuración.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-3 overflow-visible py-3 shadow-none">
        <CardHeader className="px-3">
          <h2 className={typeSection}>Anuncio en Wallapop</h2>
          <p className="text-xs text-muted-foreground">
            Un anuncio de Wallapop · se guarda aparte del producto.
          </p>
        </CardHeader>
      <CardContent className="px-3">
        <form action={formAction} noValidate className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="externalUrl">Enlace de Wallapop</Label>
            <Input
              id="externalUrl"
              name="externalUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://es.wallapop.com/item/…"
              defaultValue={listing.externalUrl ?? ""}
              className="h-11 scroll-mt-28"
              aria-invalid={Boolean(state.fieldErrors?.externalUrl)}
              aria-describedby={
                state.fieldErrors?.externalUrl ? "externalUrl-error" : undefined
              }
            />
            {state.fieldErrors?.externalUrl ? (
              <p id="externalUrl-error" className="text-xs text-destructive" role="alert">
                {state.fieldErrors.externalUrl}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Déjalo vacío para quitar el enlace.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="listingStatus">Estado del anuncio</Label>
            <Select
              value={status}
              onValueChange={(value) => value && setStatus(value as ListingStatus)}
              itemToStringLabel={(value) => listingStatusLabel(value as ListingStatus)}
              items={Object.fromEntries(
                LISTING_STATUS_OPTIONS.map((item) => [
                  item,
                  listingStatusLabel(item),
                ]),
              )}
            >
              <SelectTrigger
                id="listingStatus"
                className="h-11 w-full data-[size=default]:h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LISTING_STATUS_OPTIONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {listingStatusLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="listingStatus" value={status} />
          </div>

          {listing.externalUrl ? (
            <a
              href={listing.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
            >
              <ExternalLinkIcon className="size-4 shrink-0" />
              Abrir en Wallapop
            </a>
          ) : null}

          {state.error ? (
            <p id="listing-form-error" className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="text-sm text-muted-foreground" role="status">
              Anuncio guardado.
            </p>
          ) : null}

          <Button
            type="submit"
            variant="secondary"
            className="h-12 w-full"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            {pending ? "Guardando anuncio…" : "Guardar anuncio"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
