"use client"

import { useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import type { ListingActionState } from "@/app/actions/listing"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"

const LISTING_STATUS_OPTIONS: ListingStatus[] = [
  "READY_TO_POST",
  "ACTIVE",
  "RESERVED",
  "MISSING",
  "DEACTIVATED",
]

export function ListingShippingToggle({
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
      <input type="hidden" name="shippingEnabled" value={enabled ? "true" : "false"} />
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
  if (isPosting) return <PostingStatusFields statusId={statusId} pending={pending} />
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
        <SelectTrigger id={statusId} className="h-11 w-full data-[size=default]:h-11">
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

function PostingStatusFields({ statusId, pending }: { statusId: string; pending: boolean }) {
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
      <Button type="submit" variant="default" className="h-12 w-full" disabled={pending} aria-busy={pending}>
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
        <p id={`listing-form-error-${scope}`} className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-muted-foreground" role="status">
          Anuncio guardado.
        </p>
      ) : null}
      {isPosting ? null : (
        <Button type="submit" variant="default" className="h-12 w-full" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Guardando anuncio…" : "Guardar anuncio"}
        </Button>
      )}
    </form>
  )
}
