"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import {
  updateProductListingAction,
  type ListingActionState,
} from "@/app/actions/listing"
import { ClearListingLinkButton } from "@/components/catalog/clear-listing-link-button"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
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
import { listingStatusLabel, formatListingPostedAt } from "@/lib/inventory/format"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import type { InventoryListing } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"
import type { ListingStatus } from "@/lib/validations"
import { typeMeta, typeSection } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

const LISTING_STATUS_OPTIONS: ListingStatus[] = [
  "READY_TO_POST",
  "ACTIVE",
  "DEACTIVATED",
]

function writableListingStatus(
  status: InventoryListing["status"] | undefined,
): ListingStatus {
  if (status === "ACTIVE" || status === "DEACTIVATED") return status
  return "READY_TO_POST"
}

function ListingShippingToggle({ defaultEnabled }: { defaultEnabled: boolean }) {
  const [enabled, setEnabled] = useState(defaultEnabled)
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor="shippingEnabledSwitch">Envío</Label>
        <p id="shippingEnabled-hint" className="text-xs text-muted-foreground">
          {enabled
            ? "El comprador puede pedir envío por Wallapop."
            : "Solo recogida. No hace falta peso."}
        </p>
      </div>
      <button
        type="button"
        id="shippingEnabledSwitch"
        role="switch"
        aria-checked={enabled}
        aria-describedby="shippingEnabled-hint"
        onClick={() => setEnabled((on) => !on)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          enabled ? "bg-primary" : "bg-muted ring-1 ring-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-background shadow-sm transition-[left]",
            enabled ? "left-[1.35rem]" : "left-0.5",
          )}
        />
      </button>
      <input
        type="hidden"
        name="shippingEnabled"
        value={enabled ? "true" : "false"}
      />
    </div>
  )
}

export function ListingUrlField({
  listing,
  itemUrl,
  junkUrl,
  isPosting,
  fieldError,
}: {
  listing: InventoryListing
  itemUrl: string | null
  junkUrl: boolean
  isPosting: boolean
  fieldError?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="externalUrl">Enlace de Wallapop</Label>
      <Input
        key={listing.externalUrl ?? "empty"}
        id="externalUrl"
        name="externalUrl"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="https://es.wallapop.com/item/…"
        defaultValue={itemUrl ?? (junkUrl ? listing.externalUrl ?? "" : "")}
        className="h-11 scroll-mt-28"
        aria-invalid={Boolean(fieldError)}
        aria-describedby={fieldError ? "externalUrl-error" : "externalUrl-hint"}
      />
      {fieldError ? (
        <p id="externalUrl-error" className="text-xs text-destructive" role="alert">
          {fieldError}
        </p>
      ) : (
        <p id="externalUrl-hint" className="text-xs text-muted-foreground">
          {isPosting
            ? "Vacío no quita el enlace que ya está guardado."
            : "Solo vale un enlace /item/…. Vacío o cualquier otra URL se borra."}
        </p>
      )}
    </div>
  )
}

export function ListingStatusFields({
  isPosting,
  pending,
  status,
  onStatusChange,
}: {
  isPosting: boolean
  pending: boolean
  status: ListingStatus
  onStatusChange: (value: ListingStatus) => void
}) {
  if (isPosting) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="listingStatus">Estado del anuncio</Label>
        <input type="hidden" name="keepUrlIfEmpty" value="1" />
        <Input
          id="listingStatus"
          readOnly
          disabled
          value={listingStatusLabel("POSTING")}
          className="h-11 scroll-mt-28"
          aria-readonly="true"
        />
        <p className="text-xs text-muted-foreground">
          Se está publicando en Wallapop. No hace falta volver a publicarlo.
        </p>
        <Button
          type="submit"
          variant="default"
          className="h-12 w-full"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Guardando anuncio…" : "Guardar enlace"}
        </Button>
        <Button
          type="submit"
          name="listingStatus"
          value="ACTIVE"
          variant="outline"
          className="h-12 w-full"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          Marcar como publicado en Wallapop
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="listingStatus">Estado del anuncio</Label>
      <Select
        value={status}
        onValueChange={(value) => value && onStatusChange(value as ListingStatus)}
        itemToStringLabel={(value) => listingStatusLabel(value as ListingStatus)}
        items={Object.fromEntries(
          LISTING_STATUS_OPTIONS.map((item) => [item, listingStatusLabel(item)]),
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
  )
}

export function ListingFormBody({
  listing,
  itemUrl,
  junkUrl,
  isPosting,
  pending,
  status,
  onStatusChange,
  formAction,
  state,
}: {
  listing: InventoryListing
  itemUrl: string | null
  junkUrl: boolean
  isPosting: boolean
  pending: boolean
  status: ListingStatus
  onStatusChange: (value: ListingStatus) => void
  formAction: (payload: FormData) => void
  state: ListingActionState
}) {
  return (
    <form action={formAction} noValidate className="space-y-3">
      <ListingUrlField
        listing={listing}
        itemUrl={itemUrl}
        junkUrl={junkUrl}
        isPosting={isPosting}
        fieldError={state.fieldErrors?.externalUrl}
      />
      <ListingStatusFields
        isPosting={isPosting}
        pending={pending}
        status={status}
        onStatusChange={onStatusChange}
      />
      <ListingShippingToggle
        key={`${listing.id}-${listing.shippingEnabled ? "on" : "off"}`}
        defaultEnabled={listing.shippingEnabled !== false}
      />
      {itemUrl ? (
        <a
          href={itemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary/8 px-4 text-sm font-medium text-primary"
        >
          <ExternalLinkIcon className="size-4 shrink-0" />
          Ver anuncio publicado
        </a>
      ) : null}
      {state.error ? (
        <p
          id="listing-form-error"
          className="text-sm text-destructive"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-muted-foreground" role="status">
          Anuncio guardado.
        </p>
      ) : null}
      {isPosting ? null : (
        <Button
          type="submit"
          variant="default"
          className="h-12 w-full"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Guardando anuncio…" : "Guardar anuncio"}
        </Button>
      )}
    </form>
  )
}

export function ListingFields({
  productId,
  listing,
}: {
  productId: string
  listing: InventoryListing | null
}) {
  const router = useRouter()
  const boundAction = updateProductListingAction.bind(null, productId)
  const submitAction = async (
    prev: ListingActionState,
    formData: FormData,
  ): Promise<ListingActionState> => {
    try {
      return await boundAction(prev, formData)
    } catch (error) {
      if (isNextRedirect(error)) throw error
      return { error: actionFailureMessage(error) }
    }
  }
  const [state, formAction, pending] = useActionState(
    submitAction,
    {} as ListingActionState,
  )
  const [status, setStatus] = useState<ListingStatus>(
    writableListingStatus(listing?.status),
  )
  const [seenListingStatus, setSeenListingStatus] = useState(listing?.status)
  if (listing?.status !== seenListingStatus) {
    setSeenListingStatus(listing?.status)
    if (listing?.status && listing.status !== "POSTING") {
      setStatus(writableListingStatus(listing.status))
    }
  }
  const isPosting = listing?.status === "POSTING"
  const itemUrl = wallapopItemUrlOrNull(listing?.externalUrl)
  const junkUrl = Boolean(listing?.externalUrl) && !itemUrl

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
            La cuenta de Wallapop no está configurada. El anuncio aparecerá
            cuando se complete la configuración.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 bg-muted/50 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className={typeSection}>Anuncio en Wallapop</h2>
          <p className={typeMeta}>Se guarda aparte del producto.</p>
        </div>
        <ListingStatusBadge
          product={{ listing, listingActive: listing.status === "ACTIVE" }}
          className="shrink-0"
        />
      </CardHeader>
      <CardContent className="space-y-3 px-3 py-3">
        {junkUrl ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm leading-snug text-muted-foreground">
            El enlace guardado no es un anuncio publicado (página de alta o
            inicio). El autopost no lo cogerá hasta que lo quites.
          </p>
        ) : null}
        <ListingFormBody
          listing={listing}
          itemUrl={itemUrl}
          junkUrl={junkUrl}
          isPosting={isPosting}
          pending={pending}
          status={status}
          onStatusChange={setStatus}
          formAction={formAction}
          state={state}
        />
        {junkUrl && !isPosting ? (
          <ClearListingLinkButton productId={productId} />
        ) : null}
        {itemUrl && listing.lastPostedAt ? (
          <p className="text-xs text-muted-foreground">
            Publicado {formatListingPostedAt(listing.lastPostedAt)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
