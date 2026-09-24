"use client"

import { useActionState, useEffect, useState, type ReactNode } from "react"
import { LoaderCircleIcon } from "lucide-react"

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

  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const target =
      (key ? document.getElementById(key) : null) ??
      document.getElementById("form-error")
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state])

  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-4 px-4 py-4 md:px-8 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:py-6"
    >
      <div className="min-w-0 lg:sticky lg:top-28 lg:col-span-7">
        <FormSection title="Фото">
          <div id="images" tabIndex={-1} className="scroll-mt-28 outline-none">
            <PhotoSlots images={images} onChange={setImages} />
          </div>
          <input type="hidden" name="images" value={JSON.stringify(images)} />
          {state.fieldErrors?.images ? (
            <p id="images-error" className="text-xs text-destructive" role="alert">
              {state.fieldErrors.images}
            </p>
          ) : null}
        </FormSection>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
        <FormSection title="Основне">
        <Field label="Title" htmlFor="title" error={state.fieldErrors?.title}>
          <Input
            id="title"
            name="title"
            defaultValue={product?.title}
            className="h-11 scroll-mt-28"
            aria-invalid={Boolean(state.fieldErrors?.title)}
            aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
          />
        </Field>
        <Field label="SKU" htmlFor="sku" error={state.fieldErrors?.sku}>
          <Input
            id="sku"
            name="sku"
            defaultValue={product?.sku}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.sku)}
            aria-describedby={state.fieldErrors?.sku ? "sku-error" : undefined}
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
            className="scroll-mt-28"
            aria-invalid={Boolean(state.fieldErrors?.description)}
            aria-describedby={
              state.fieldErrors?.description ? "description-error" : undefined
            }
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
            inputMode="decimal"
            defaultValue={product?.price}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.price)}
            aria-describedby={state.fieldErrors?.price ? "price-error" : undefined}
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
            inputMode="decimal"
            defaultValue={product?.weight ?? ""}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.weight)}
            aria-describedby={state.fieldErrors?.weight ? "weight-error" : undefined}
          />
        </Field>
        <Field label="Category" htmlFor="category" error={state.fieldErrors?.category}>
          <Select
            name="category"
            value={category}
            onValueChange={(value) => value && setCategory(value)}
            items={Object.fromEntries(
              PRODUCT_CATEGORIES.map((item) => [item, item]),
            )}
          >
            <SelectTrigger
              id="category"
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.category)}
              aria-describedby={
                state.fieldErrors?.category ? "category-error" : undefined
              }
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
        <Field label="Condition" htmlFor="condition" error={state.fieldErrors?.condition}>
          <Select
            name="condition"
            value={condition}
            onValueChange={(value) => value && setCondition(value)}
            items={Object.fromEntries(
              PRODUCT_CONDITIONS.map((item) => [item, item]),
            )}
          >
            <SelectTrigger
              id="condition"
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.condition)}
              aria-describedby={
                state.fieldErrors?.condition ? "condition-error" : undefined
              }
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
        <Field label="Status" htmlFor="status" error={state.fieldErrors?.status}>
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
              id="status"
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.status)}
              aria-describedby={
                state.fieldErrors?.status ? "status-error" : undefined
              }
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
        <p id="form-error" className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        className="h-12 w-full scroll-mb-28"
        size="lg"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        {pending ? "Saving…" : submitLabel}
      </Button>
      </div>
    </form>
  )
}

function FormSection({
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

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
