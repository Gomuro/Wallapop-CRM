"use client"

import { useRouter } from "next/navigation"
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react"
import { LoaderCircleIcon } from "lucide-react"

import { PhotoSlots } from "@/components/product-form/photo-slots"
import { CategoryPicker } from "@/components/product-form/category-picker"
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
import {
  OfflineSkuError,
  rememberOfflineCategories,
  upsertOfflineProduct,
} from "@/lib/offline/cache"
import { statusLabel } from "@/lib/inventory/format"
import { PRODUCT_CONDITION_OPTIONS } from "@/lib/inventory/conditions"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ApiCategory } from "@/lib/api/types"
import type { ProductCondition, ProductStatus } from "@/lib/validations"
import { typeSection } from "@/lib/ui/type"

const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "INACTIVE", "SOLD"]

export function ProductForm({
  product,
  categories,
  action,
  submitLabel,
}: {
  product?: InventoryProduct
  categories: ApiCategory[]
  action: (
    state: ProductActionState,
    formData: FormData,
  ) => Promise<ProductActionState>
  submitLabel: string
}) {
  const router = useRouter()
  const submitAction = useCallback(
    async (prev: ProductActionState, formData: FormData) => {
      const result = await action(prev, formData)
      if (!result.offlineDraft) return result
      try {
        rememberOfflineCategories(categories)
        const saved = upsertOfflineProduct(result.offlineDraft, categories)
        router.push(`/products/${saved.id}`)
        router.refresh()
        return {}
      } catch (error) {
        if (error instanceof OfflineSkuError) {
          return {
            error: error.message,
            fieldErrors: { sku: error.message },
          }
        }
        return { error: "No se pudo guardar el producto en este dispositivo." }
      }
    },
    [action, categories, router],
  )
  const [state, formAction, pending] = useActionState(submitAction, {})
  const [isPending, startTransition] = useTransition()
  const pendingFilesRef = useRef<File[]>([])
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "")
  const [condition, setCondition] = useState<ProductCondition>(
    product?.conditionCode ?? "GOOD",
  )
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE")

  const saving = pending || isPending

  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const target =
      (key ? document.getElementById(key) : null) ??
      document.getElementById("form-error")
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    pendingFilesRef.current.forEach((file) => formData.append("files", file))
    startTransition(() => {
      formAction(formData)
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      encType="multipart/form-data"
      noValidate
      className="flex flex-col gap-4 px-4 py-4 md:px-8 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:py-6"
    >
      <div className="min-w-0 lg:sticky lg:top-28 lg:col-span-7">
        <FormSection title="Fotos">
          <div id="images" tabIndex={-1} className="scroll-mt-28 outline-none">
            <PhotoSlots
              productId={product?.id}
              productImages={product?.productImages}
              onPendingFilesChange={(files) => {
                pendingFilesRef.current = files
              }}
            />
          </div>
          {state.fieldErrors?.images ? (
            <p id="images-error" className="text-xs text-destructive" role="alert">
              {state.fieldErrors.images}
            </p>
          ) : null}
        </FormSection>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
        <FormSection title="Detalles del producto">
        <Field label="Título" htmlFor="title" error={state.fieldErrors?.title}>
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
          label="Descripción"
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

      <FormSection title="Precio">
        <Field label="Precio (€)" htmlFor="price" error={state.fieldErrors?.price}>
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

      <FormSection title="Parámetros">
        <Field
          label="Peso"
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
        <div id="categoryId" tabIndex={-1} className="scroll-mt-28 outline-none">
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            error={state.fieldErrors?.categoryId}
          />
        </div>
        <Field label="Estado" htmlFor="condition" error={state.fieldErrors?.condition}>
          <Select
            name="condition"
            value={condition}
            onValueChange={(value) => value && setCondition(value as ProductCondition)}
            items={Object.fromEntries(
              PRODUCT_CONDITION_OPTIONS.map((item) => [item.value, item.label]),
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
              {PRODUCT_CONDITION_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Estado de venta" htmlFor="status" error={state.fieldErrors?.status}>
          <Select
            name="status"
            value={status}
            onValueChange={(value) => value && setStatus(value as ProductStatus)}
            itemToStringLabel={(value) => statusLabel(value as ProductStatus)}
            items={{
              ACTIVE: "En venta",
              INACTIVE: "Inactivo",
              SOLD: "Vendido",
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
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
        {saving ? "Guardando…" : submitLabel}
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
