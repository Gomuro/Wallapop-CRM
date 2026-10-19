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
import { computeListingActive } from "@/lib/inventory/listing-active"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"
import type { ListingStatus } from "@/lib/validations"
import { typeMeta, typeSection } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

const LISTING_STATUS_OPTIONS: ListingStatus[] = [
  "READY_TO_POST",
  "ACTIVE",
  "RESERVED",
  "DEACTIVATED",
]

function writableListingStatus(
  status: InventoryListing["status"] | undefined,
): ListingStatus {
  if (
    status === "ACTIVE" ||
    status === "RESERVED" ||
    status === "DEACTIVATED"
  ) {
    return status
  }
  return "READY_TO_POST"
}

function ListingShippingToggle({
  defaultEnabled,
  scope,
}: {
  defaultEnabled: boolean
  scope: string
}) {
  const switchId = `shippingEnabledSwitch-${scope}`
  const hintId = `shippingEnabled-hint-${scope}`
  const [enabled, setEnabled] = useState(defaultEnabled)
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={switchId}>Envío</Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          {enabled
            ? "El comprador puede pedir envío por Wallapop."
            : "Solo recogida. No hace falta peso."}
        </p>
      </div>
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={enabled}
        aria-describedby={hintId}
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
  scope,
}: {
  listing: InventoryListing
  itemUrl: string | null
  junkUrl: boolean
  isPosting: boolean
  fieldError?: string
  scope: string
}) {
  const fieldId = `externalUrl-${scope}`
  const errorId = `externalUrl-error-${scope}`
  const hintId = `externalUrl-hint-${scope}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>Enlace de Wallapop</Label>
      <Input
        key={listing.externalUrl ?? "empty"}
        id={fieldId}
        name="externalUrl"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="https://es.wallapop.com/item/…"
        defaultValue={itemUrl ?? (junkUrl ? listing.externalUrl ?? "" : "")}
        className="h-11 scroll-mt-28"
        aria-invalid={Boolean(fieldError)}
        aria-describedby={fieldError ? errorId : hintId}
      />
      {fieldError ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {fieldError}
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
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
  scope,
}: {
  isPosting: boolean
  pending: boolean
  status: ListingStatus
  onStatusChange: (value: ListingStatus) => void
  scope: string
}) {
  const statusId = `listingStatus-${scope}`
  if (isPosting) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={statusId}>Estado del anuncio</Label>
        <input type="hidden" name="keepUrlIfEmpty" value="1" />
        <Input
          id={statusId}
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
      <Label htmlFor={statusId}>Estado del anuncio</Label>
      <Select
        value={status}
        onValueChange={(value) => value && onStatusChange(value as ListingStatus)}
        itemToStringLabel={(value) => listingStatusLabel(value as ListingStatus)}
        items={Object.fromEntries(
          LISTING_STATUS_OPTIONS.map((item) => [item, listingStatusLabel(item)]),
        )}
      >
        <SelectTrigger
          id={statusId}
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
  accountId,
  scope,
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
  accountId: string
  scope: string
}) {
  return (
    <form action={formAction} noValidate className="space-y-3">
      {accountId ? <input type="hidden" name="accountId" value={accountId} /> : null}
      <ListingUrlField
        listing={listing}
        itemUrl={itemUrl}
        junkUrl={junkUrl}
        isPosting={isPosting}
        fieldError={state.fieldErrors?.externalUrl}
        scope={scope}
      />
      <ListingStatusFields
        isPosting={isPosting}
        pending={pending}
        status={status}
        onStatusChange={onStatusChange}
        scope={scope}
      />
      <ListingShippingToggle
        key={`${listing.id}-${listing.shippingEnabled ? "on" : "off"}`}
        defaultEnabled={listing.shippingEnabled !== false}
        scope={scope}
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
          id={`listing-form-error-${scope}`}
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

function blankListing(accountId: string, accountName: string): InventoryListing {
  return {
    id: accountId,
    accountId,
    accountName,
    externalUrl: null,
    status: "READY_TO_POST",
    lastPostedAt: null,
    shippingEnabled: true,
  }
}

export function ListingFields({
  productId,
  listing,
  warehouseStatus,
  accountId,
  accountName,
}: {
  productId: string
  listing: InventoryListing | null
  warehouseStatus: InventoryProduct["status"]
  accountId?: string
  accountName?: string
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
  const resolvedAccountId = accountId || listing?.accountId || ""
  const resolvedName = accountName?.trim() || listing?.accountName?.trim() || ""
  const scope = resolvedAccountId || "default"
  const shown = listing ?? (resolvedAccountId ? blankListing(resolvedAccountId, resolvedName) : null)
  const isPosting = shown?.status === "POSTING"
  const itemUrl = wallapopItemUrlOrNull(shown?.externalUrl)
  const junkUrl = Boolean(shown?.externalUrl) && !itemUrl

  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const scoped =
      key === "externalUrl" ? `externalUrl-${accountId || listing?.accountId || "default"}` : key
    const target =
      (scoped ? document.getElementById(scoped) : null) ??
      document.getElementById(
        `listing-form-error-${accountId || listing?.accountId || "default"}`,
      )
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state, accountId, listing?.accountId])

  useEffect(() => {
    if (state.success) router.refresh()
  }, [state.success, router])

  if (!shown) {
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
          <h2 className={typeSection}>{resolvedName || "Anuncio en Wallapop"}</h2>
          <p className={typeMeta}>
            {resolvedName ? "Anuncio en Wallapop" : "Se guarda aparte del producto."}
          </p>
        </div>
        <ListingStatusBadge
          product={{
            status: warehouseStatus,
            listing: shown,
            listingActive: computeListingActive(shown),
          }}
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
          listing={shown}
          itemUrl={itemUrl}
          junkUrl={junkUrl}
          isPosting={isPosting}
          pending={pending}
          status={status}
          onStatusChange={setStatus}
          formAction={formAction}
          state={state}
          accountId={resolvedAccountId}
          scope={scope}
        />
        {junkUrl && !isPosting ? (
          <ClearListingLinkButton productId={productId} accountId={resolvedAccountId} />
        ) : null}
        {itemUrl && shown.lastPostedAt ? (
          <p className="text-xs text-muted-foreground">
            Publicado {formatListingPostedAt(shown.lastPostedAt)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function cardsFor(product: InventoryProduct): {
  accountId: string
  accountName: string
  listing: InventoryListing | null
}[] {
  const listings =
    product.listings && product.listings.length > 0
      ? product.listings
      : product.listing
        ? [product.listing]
        : []
  if (product.accountStates && product.accountStates.length > 0) {
    return product.accountStates.map((state) => ({
      accountId: state.accountId,
      accountName: state.accountName,
      listing: listings.find((row) => row.accountId === state.accountId) ?? null,
    }))
  }
  if (product.listing) {
    return [
      {
        accountId: product.listing.accountId,
        accountName: product.listing.accountName ?? "Cuenta",
        listing: product.listing,
      },
    ]
  }
  return []
}

export function ListingFieldsList({ product }: { product: InventoryProduct }) {
  const cards = cardsFor(product)
  if (cards.length === 0) {
    return (
      <ListingFields
        productId={product.id}
        listing={null}
        warehouseStatus={product.status}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => (
        <ListingFields
          key={card.accountId || "default"}
          productId={product.id}
          listing={card.listing}
          accountId={card.accountId}
          accountName={card.accountName}
          warehouseStatus={product.status}
        />
      ))}
    </div>
  )
}
