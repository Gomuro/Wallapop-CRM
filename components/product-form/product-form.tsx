"use client"

import { useActionState, useState } from "react"

import { PhotoSlots } from "@/components/product-form/photo-slots"
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
import { Textarea } from "@/components/ui/textarea"
import type { ProductActionState } from "@/app/actions/products"
import { statusLabel } from "@/lib/inventory/format"
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CONDITIONS,
  type InventoryProduct,
} from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"
import { typeSection } from "@/lib/ui/type"

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
  const [images, setImages] = useState<string[]>(() =>
    Array.isArray(product?.images)
      ? product.images.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : [],
  )
  const [category, setCategory] = useState(product?.category ?? "Electronics")
  const [condition, setCondition] = useState(product?.condition ?? "Good")
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE")

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-4">
      <FormSection title="Фото">
        <PhotoSlots images={images} onChange={setImages} />
      </FormSection>
      <input type="hidden" name="images" value={JSON.stringify(images)} />

      <FormSection title="Основне">
        <Field label="Title" htmlFor="title" error={state.fieldErrors?.title}>
          <Input
            id="title"
            name="title"
            required
            defaultValue={product?.title}
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors?.title)}
          />
        </Field>
        <Field label="SKU" htmlFor="sku" error={state.fieldErrors?.sku}>
          <Input
            id="sku"
            name="sku"
            required
            defaultValue={product?.sku}
            className="h-11 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.sku)}
          />
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
            aria-invalid={Boolean(state.fieldErrors?.description)}
          />
        </Field>
      </FormSection>

      <FormSection title="Ціноутворення">
        <Field label="Price (€)" htmlFor="price" error={state.fieldErrors?.price}>
          <Input
            id="price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={product?.price}
            className="h-11 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.price)}
          />
        </Field>
      </FormSection>

      <FormSection title="Параметри">
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
            className="h-11 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.weight)}
          />
        </Field>
        <Field label="Category" error={state.fieldErrors?.category}>
          <Select
            name="category"
            value={category}
            onValueChange={(value) => value && setCategory(value)}
            items={Object.fromEntries(
              PRODUCT_CATEGORIES.map((item) => [item, item]),
            )}
          >
            <SelectTrigger
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.category)}
            >
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
            name="condition"
            value={condition}
            onValueChange={(value) => value && setCondition(value)}
            items={Object.fromEntries(
              PRODUCT_CONDITIONS.map((item) => [item, item]),
            )}
          >
            <SelectTrigger
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.condition)}
            >
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
            name="status"
            value={status}
            onValueChange={(value) => value && setStatus(value as ProductStatus)}
            itemToStringLabel={(value) => statusLabel(value as ProductStatus)}
            items={{
              ACTIVE: "Active",
              INACTIVE: "Inactive",
              SOLD: "Sold",
            }}
          >
            <SelectTrigger
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.status)}
            >
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
      </FormSection>

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

function FormSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
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
