"use client"

import { CategoryPicker } from "@/components/product-form/category-picker"
import { Field, FormSection } from "@/components/product-form/product-form-chrome"
import { Input } from "@/components/ui/input"
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
import { PRODUCT_CONDITION_OPTIONS } from "@/lib/inventory/conditions"
import { SHIPPING_PACKAGE_SIZE_OPTIONS } from "@/lib/inventory/package-size"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ApiCategory } from "@/lib/api/types"
import type { ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"
import { loadDraftFields } from "@/lib/product-form/draft"

const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "INACTIVE", "SOLD"]

export function ProductFormFields({
  product,
  draft,
  state,
  shippingPackageSize,
  setShippingPackageSize,
  categoryId,
  setCategoryId,
  categories,
  initialRoots,
  condition,
  setCondition,
  status,
  setStatus,
}: {
  product?: InventoryProduct
  draft: ReturnType<typeof loadDraftFields>
  state: ProductActionState
  shippingPackageSize: ShippingPackageSize
  setShippingPackageSize: (value: ShippingPackageSize) => void
  categoryId: string
  setCategoryId: (value: string) => void
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  condition: ProductCondition
  setCondition: (value: ProductCondition) => void
  status: ProductStatus
  setStatus: (value: ProductStatus) => void
}) {
  return (
    <>
      <FormSection title="Detalles del producto">
        {product?.sku ? (
          <input type="hidden" name="sku" value={product.sku} />
        ) : null}
        <Field label="Título" htmlFor="title" error={state.fieldErrors?.title}>
          <Input
            id="title"
            name="title"
            defaultValue={product?.title ?? draft?.title}
            className="h-11 scroll-mt-28"
            aria-invalid={Boolean(state.fieldErrors?.title)}
            aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
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
            defaultValue={product?.description ?? draft?.description}
            className="scroll-mt-28"
            aria-invalid={Boolean(state.fieldErrors?.description)}
            aria-describedby={
              state.fieldErrors?.description ? "description-error" : undefined
            }
          />
        </Field>
      </FormSection>
      <ProductFormParams
        product={product}
        draft={draft}
        state={state}
        shippingPackageSize={shippingPackageSize}
        setShippingPackageSize={setShippingPackageSize}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        categories={categories}
        initialRoots={initialRoots}
        condition={condition}
        setCondition={setCondition}
        status={status}
        setStatus={setStatus}
      />
      {state.error ? (
        <p id="form-error" className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </>
  )
}

export function ProductFormParams({
  product,
  draft,
  state,
  shippingPackageSize,
  setShippingPackageSize,
  categoryId,
  setCategoryId,
  categories,
  initialRoots,
  condition,
  setCondition,
  status,
  setStatus,
}: {
  product?: InventoryProduct
  draft: ReturnType<typeof loadDraftFields>
  state: ProductActionState
  shippingPackageSize: ShippingPackageSize
  setShippingPackageSize: (value: ShippingPackageSize) => void
  categoryId: string
  setCategoryId: (value: string) => void
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  condition: ProductCondition
  setCondition: (value: ProductCondition) => void
  status: ProductStatus
  setStatus: (value: ProductStatus) => void
}) {
  return (
    <>
      <FormSection title="Precio">
        <Field label="Precio (€)" htmlFor="price" error={state.fieldErrors?.price}>
          <Input
            id="price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={product?.price ?? draft?.price}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.price)}
            aria-describedby={state.fieldErrors?.price ? "price-error" : undefined}
          />
        </Field>
      </FormSection>
      <FormSection title="Parámetros">
        <Field label="Peso" htmlFor="weight" error={state.fieldErrors?.weight}>
          <Input
            id="weight"
            name="weight"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={product?.weight ?? draft?.weight ?? ""}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.weight)}
            aria-describedby={state.fieldErrors?.weight ? "weight-error" : undefined}
          />
        </Field>
        <Field
          label="Tamaño del paquete"
          htmlFor="shippingPackageSize"
          error={state.fieldErrors?.shippingPackageSize}
        >
          <Select
            name="shippingPackageSize"
            value={shippingPackageSize}
            onValueChange={(value) =>
              value && setShippingPackageSize(value as ShippingPackageSize)
            }
            items={Object.fromEntries(
              SHIPPING_PACKAGE_SIZE_OPTIONS.map((item) => [item.value, item.label]),
            )}
          >
            <SelectTrigger
              id="shippingPackageSize"
              className="h-11 w-full data-[size=default]:h-11"
              aria-invalid={Boolean(state.fieldErrors?.shippingPackageSize)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHIPPING_PACKAGE_SIZE_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <ProductFormDimensions product={product} draft={draft} state={state} />
        <ProductFormSaleMeta
          product={product}
          draft={draft}
          state={state}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          categories={categories}
          initialRoots={initialRoots}
          condition={condition}
          setCondition={setCondition}
          status={status}
          setStatus={setStatus}
        />
      </FormSection>
    </>
  )
}

export function ProductFormDimensions({
  product,
  draft,
  state,
}: {
  product?: InventoryProduct
  draft: ReturnType<typeof loadDraftFields>
  state: ProductActionState
}) {
  return (
    <div id="widthCm" tabIndex={-1} className="scroll-mt-28 outline-none">
      <p className="text-sm font-medium">Dimensiones del producto (en cm)</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Opcional. Las opciones de envío pueden variar según el tamaño del artículo.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field label="Ancho" htmlFor="widthCmInput" error={state.fieldErrors?.widthCm}>
          <Input
            id="widthCmInput"
            name="widthCm"
            type="number"
            min="1"
            max="999"
            step="1"
            inputMode="numeric"
            defaultValue={product?.widthCm ?? draft?.widthCm ?? ""}
            className="h-11 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.widthCm)}
          />
        </Field>
        <Field label="Fondo" htmlFor="lengthCm">
          <Input
            id="lengthCm"
            name="lengthCm"
            type="number"
            min="1"
            max="999"
            step="1"
            inputMode="numeric"
            defaultValue={product?.lengthCm ?? draft?.lengthCm ?? ""}
            className="h-11 tabular-nums"
          />
        </Field>
        <Field label="Alto" htmlFor="heightCm">
          <Input
            id="heightCm"
            name="heightCm"
            type="number"
            min="1"
            max="999"
            step="1"
            inputMode="numeric"
            defaultValue={product?.heightCm ?? draft?.heightCm ?? ""}
            className="h-11 tabular-nums"
          />
        </Field>
      </div>
    </div>
  )
}

export function ProductFormSaleMeta({
  product,
  draft,
  state,
  categoryId,
  setCategoryId,
  categories,
  initialRoots,
  condition,
  setCondition,
  status,
  setStatus,
}: {
  product?: InventoryProduct
  draft: ReturnType<typeof loadDraftFields>
  state: ProductActionState
  categoryId: string
  setCategoryId: (value: string) => void
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  condition: ProductCondition
  setCondition: (value: ProductCondition) => void
  status: ProductStatus
  setStatus: (value: ProductStatus) => void
}) {
  return (
    <>
      <div id="categoryId" tabIndex={-1} className="scroll-mt-28 outline-none">
        <CategoryPicker
          categories={categories}
          initialRoots={initialRoots}
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
      <Field
        label="Marca"
        htmlFor="brand"
        required
        error={state.fieldErrors?.brand}
      >
        <Input
          id="brand"
          name="brand"
          required
          aria-required="true"
          maxLength={100}
          defaultValue={product?.brand ?? draft?.brand ?? ""}
          className="h-11"
          placeholder="Quirumed, Nike…"
          aria-invalid={Boolean(state.fieldErrors?.brand)}
          aria-describedby={
            state.fieldErrors?.brand ? "brand-error" : undefined
          }
        />
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
    </>
  )
}
