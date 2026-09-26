"use client"

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
import { statusLabel } from "@/lib/inventory/format"
import { PRODUCT_CONDITION_OPTIONS } from "@/lib/inventory/conditions"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ApiCategory } from "@/lib/api/types"
import type { ProductCondition, ProductStatus } from "@/lib/validations"
import { typeSection } from "@/lib/ui/type"
import {
  clearAllDraftData,
  clearDraftFields,
  clearDraftPhotos,
  loadDraftFields,
  saveDraftFields,
  saveDraftPhotos,
} from "@/lib/product-form/draft"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"

const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "INACTIVE", "SOLD"]

export function ProductForm({
  product,
  categories,
  initialRoots,
  action,
  submitLabel,
  restoreDraft = false,
}: {
  product?: InventoryProduct
  categories?: ApiCategory[]
  initialRoots?: ApiCategory[]
  action: (
    state: ProductActionState,
    formData: FormData,
  ) => Promise<ProductActionState>
  submitLabel: string
  restoreDraft?: boolean
}) {
  const isNew = !product
  const isSubmittingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [resetKey, setResetKey] = useState(0)
  const pendingFilesRef = useRef<File[]>([])
  const [draft, setDraft] = useState<ReturnType<typeof loadDraftFields>>(null)
  const [draftReady, setDraftReady] = useState(!isNew || !restoreDraft)
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "")
  const [condition, setCondition] = useState<ProductCondition>(
    product?.conditionCode ?? "GOOD",
  )
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE")

  const resetFormState = useCallback(() => {
    formRef.current?.reset()
    pendingFilesRef.current = []
    setDraft(null)
    setCategoryId("")
    setCondition("GOOD")
    setStatus("ACTIVE")
    setResetKey((prev) => prev + 1)
    isSubmittingRef.current = false
    void clearAllDraftData()
  }, [])

  const submitAction = useCallback(
    async (prev: ProductActionState, formData: FormData) => {
      isSubmittingRef.current = true
      const snapshot = isNew && restoreDraft ? loadDraftFields() : null
      if (isNew) {
        await clearAllDraftData()
      }
      try {
        const result = await action(prev, formData)
        if (result.error || result.fieldErrors) {
          isSubmittingRef.current = false
          if (snapshot) saveDraftFields(snapshot)
          if (restoreDraft && pendingFilesRef.current.length > 0) {
            void saveDraftPhotos(pendingFilesRef.current)
          }
        } else {
          resetFormState()
        }
        return result
      } catch (error) {
        if (isNextRedirect(error)) {
          resetFormState()
          throw error
        }
        isSubmittingRef.current = false
        if (snapshot) saveDraftFields(snapshot)
        if (restoreDraft && pendingFilesRef.current.length > 0) {
          void saveDraftPhotos(pendingFilesRef.current)
        }
        return { error: actionFailureMessage(error) }
      }
    },
    [action, isNew, resetFormState, restoreDraft],
  )
  const [state, formAction, pending] = useActionState(submitAction, {})
  const [isPending, startTransition] = useTransition()

  const saving = pending || isPending

  useEffect(() => {
    if (!isNew) return
    if (!restoreDraft) {
      void clearAllDraftData()
      setDraft(null)
      setDraftReady(true)
      return
    }
    const saved = loadDraftFields()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate draft from client-only sessionStorage on mount
    setDraft(saved)
    if (saved?.categoryId) setCategoryId(saved.categoryId)
    if (saved?.condition) setCondition(saved.condition as ProductCondition)
    if (saved?.status) setStatus(saved.status as ProductStatus)
    if (!saved) {
      void clearDraftPhotos()
    }
    setDraftReady(true)
  }, [isNew, restoreDraft])

  useEffect(() => {
    if (!isNew || !restoreDraft || !draftReady || isSubmittingRef.current) return
    const current = loadDraftFields()
    if (!current && !categoryId) return
    saveDraftFields({
      title: current?.title ?? "",
      sku: current?.sku ?? "",
      description: current?.description ?? "",
      price: current?.price ?? "",
      weight: current?.weight ?? "",
      categoryId,
      condition,
      status,
    })
  }, [categoryId, condition, draftReady, isNew, restoreDraft, status])

  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const target =
      (key ? document.getElementById(key) : null) ??
      document.getElementById("form-error")
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state])

  function persistFromForm(form: HTMLFormElement) {
    if (!isNew || !restoreDraft || isSubmittingRef.current) return
    const formData = new FormData(form)
    saveDraftFields({
      title: String(formData.get("title") ?? ""),
      sku: String(formData.get("sku") ?? ""),
      description: String(formData.get("description") ?? ""),
      price: String(formData.get("price") ?? ""),
      weight: String(formData.get("weight") ?? ""),
      categoryId,
      condition,
      status,
    })
  }

  const handlePendingFilesChange = useCallback(
    (files: File[]) => {
      pendingFilesRef.current = files
      if (isNew && restoreDraft && !isSubmittingRef.current) {
        void saveDraftPhotos(files)
        if (files.length > 0) {
          const current = loadDraftFields() ?? {
            title: "",
            sku: "",
            description: "",
            price: "",
            weight: "",
            categoryId,
            condition,
            status,
          }
          saveDraftFields(current)
        }
      }
    },
    [categoryId, condition, isNew, restoreDraft, status],
  )

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    isSubmittingRef.current = true
    if (restoreDraft) {
      persistFromForm(event.currentTarget)
    }
    const formData = new FormData(event.currentTarget)
    pendingFilesRef.current.forEach((file) => formData.append("files", file))
    startTransition(() => {
      formAction(formData)
    })
  }

  if (!draftReady) {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground">Cargando formulario…</p>
    )
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onChange={(event) => persistFromForm(event.currentTarget)}
      encType="multipart/form-data"
      noValidate
      className="flex flex-col gap-4 px-4 py-4 pb-28 md:px-8 md:pb-8 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:py-6"
    >
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
            defaultValue={product?.title ?? draft?.title}
            className="h-11 scroll-mt-28"
            aria-invalid={Boolean(state.fieldErrors?.title)}
            aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
          />
        </Field>
        <Field label="SKU" htmlFor="sku" error={state.fieldErrors?.sku}>
          <Input
            id="sku"
            name="sku"
            defaultValue={product?.sku ?? draft?.sku}
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
            defaultValue={product?.description ?? draft?.description}
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
            defaultValue={product?.price ?? draft?.price}
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
            defaultValue={product?.weight ?? draft?.weight ?? ""}
            className="h-11 scroll-mt-28 tabular-nums"
            aria-invalid={Boolean(state.fieldErrors?.weight)}
            aria-describedby={state.fieldErrors?.weight ? "weight-error" : undefined}
          />
        </Field>
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
