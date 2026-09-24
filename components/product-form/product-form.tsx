"use client"

import { useActionState, useState } from "react"

import { PhotoSlots } from "@/components/product-form/photo-slots"
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
import { Textarea } from "@/components/ui/textarea"
import type { ProductActionState } from "@/app/actions/products"
import { statusLabel } from "@/lib/inventory/format"
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CONDITIONS,
  type InventoryProduct,
} from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "INACTIVE", "SOLD"]

export function ProductForm({
  product,
  action,
  submitLabel,
}: {
  product?: InventoryProduct
  action: (
    state: ProductActionState,
    formData: FormData,
  ) => Promise<ProductActionState>
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  const [images, setImages] = useState(product?.images ?? [])
  const [category, setCategory] = useState(product?.category ?? "Electronics")
  const [condition, setCondition] = useState(product?.condition ?? "Good")
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE")

  return (
    <form action={formAction} className="space-y-4 px-4 py-4">
      <PhotoSlots images={images} onChange={setImages} />
      <input type="hidden" name="images" value={JSON.stringify(images)} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="condition" value={condition} />
      <input type="hidden" name="status" value={status} />

      <Field label="Title" htmlFor="title" error={state.fieldErrors?.title}>
        <Input
          id="title"
          name="title"
          required
          defaultValue={product?.title}
          className="h-11"
        />
      </Field>
      <Field label="SKU" htmlFor="sku" error={state.fieldErrors?.sku}>
        <Input
          id="sku"
          name="sku"
          required
          defaultValue={product?.sku}
          className="h-11"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (€)" htmlFor="price" error={state.fieldErrors?.price}>
          <Input
            id="price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={product?.price}
            className="h-11"
          />
        </Field>
        <Field
          label="Weight (kg)"
          htmlFor="weight"
          error={state.fieldErrors?.weight}
        >
          <Input
            id="weight"
            name="weight"
            type="number"
            min="0"
            step="0.01"
            defaultValue={product?.weight ?? ""}
            className="h-11"
          />
        </Field>
      </div>
      <Field label="Category" error={state.fieldErrors?.category}>
        <Select value={category} onValueChange={(value) => value && setCategory(value)}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_CATEGORIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Condition" error={state.fieldErrors?.condition}>
        <Select
          value={condition}
          onValueChange={(value) => value && setCondition(value)}
        >
          <SelectTrigger className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_CONDITIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Status" error={state.fieldErrors?.status}>
        <Select
          value={status}
          onValueChange={(value) => value && setStatus(value as ProductStatus)}
        >
          <SelectTrigger className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {statusLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Description"
        htmlFor="description"
        error={state.fieldErrors?.description}
      >
        <Textarea
          id="description"
          name="description"
          rows={5}
          defaultValue={product?.description}
        />
      </Field>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full" size="lg" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
