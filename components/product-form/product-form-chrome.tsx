"use client"

import { type ReactNode } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { PhotoSlots } from "@/components/product-form/photo-slots"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { loadDraftFields } from "@/lib/product-form/draft"
import type { InventoryProduct } from "@/lib/inventory/types"
import { typeSection } from "@/lib/ui/type"

export function ProductFormPhotos({
  resetKey,
  product,
  restoreDraft,
  draft,
  handlePendingFilesChange,
  imagesError,
}: {
  resetKey: number
  product?: InventoryProduct
  restoreDraft: boolean
  draft: ReturnType<typeof loadDraftFields>
  handlePendingFilesChange: (files: File[]) => void
  imagesError?: string
}) {
  return (
    <div className="min-w-0 lg:sticky lg:top-28 lg:col-span-7">
      <FormSection title="Fotos">
        <div id="images" tabIndex={-1} className="scroll-mt-28 outline-none">
          <PhotoSlots
            key={`photo-slots-${resetKey}`}
            productId={product?.id}
            productImages={product?.productImages}
            restoreDraft={restoreDraft && Boolean(draft)}
            onPendingFilesChange={handlePendingFilesChange}
          />
        </div>
        {imagesError ? (
          <p id="images-error" className="text-xs text-destructive" role="alert">
            {imagesError}
          </p>
        ) : null}
      </FormSection>
    </div>
  )
}

export function ProductFormSubmit({
  saving,
  submitLabel,
}: {
  saving: boolean
  submitLabel: string
}) {
  return (
    <Button
      type="submit"
      className="h-12 w-full scroll-mb-28"
      size="lg"
      disabled={saving}
      aria-busy={saving}
    >
      {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
      {saving ? "Guardando…" : submitLabel}
    </Button>
  )
}

export function FormSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Card className="gap-3 overflow-visible py-3 shadow-none">
      <CardHeader className="px-3">
        <h2 className={typeSection}>{title}</h2>
      </CardHeader>
      <CardContent className="space-y-3 px-3">{children}</CardContent>
    </Card>
  )
}

export function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
