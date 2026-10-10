"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react"

import {
  ProductFormPhotos,
  ProductFormSubmit,
} from "@/components/product-form/product-form-chrome"
import { ProductFormFields } from "@/components/product-form/product-form-fields"
import type { ProductActionState } from "@/app/actions/products"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ApiCategory } from "@/lib/api/types"
import type { ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"
import {
  clearAllDraftData,
  clearDraftPhotos,
  loadDraftFields,
  saveDraftFields,
  saveDraftPhotos,
} from "@/lib/product-form/draft"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import { submitProductForm } from "@/components/product-form/product-form-submit"

export {
  ProductFormFields,
  ProductFormParams,
  ProductFormDimensions,
  ProductFormSaleMeta,
} from "@/components/product-form/product-form-fields"
export {
  ProductFormPhotos,
  ProductFormSubmit,
} from "@/components/product-form/product-form-chrome"

type ProductFormAction = (
  state: ProductActionState,
  formData: FormData,
) => Promise<ProductActionState>

export function useProductFormDraft(
  product: InventoryProduct | undefined,
  restoreDraft: boolean,
) {
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
  const [shippingPackageSize, setShippingPackageSize] =
    useState<ShippingPackageSize>(product?.shippingPackageSize ?? "STANDARD")
  const [weightKg, setWeightKg] = useState(
    product?.weight != null ? String(product.weight) : "",
  )
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE")

  const resetFormState = useCallback(() => {
    formRef.current?.reset()
    pendingFilesRef.current = []
    setDraft(null)
    setCategoryId("")
    setCondition("GOOD")
    setShippingPackageSize("STANDARD")
    setWeightKg("")
    setStatus("ACTIVE")
    setResetKey((prev) => prev + 1)
    isSubmittingRef.current = false
    void clearAllDraftData()
  }, [])

  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (isNew && restoreDraft && isClient && !draftReady) {
    const saved = loadDraftFields()
    setDraft(saved)
    if (saved?.categoryId) setCategoryId(saved.categoryId)
    if (saved?.condition) setCondition(saved.condition as ProductCondition)
    if (
      saved?.shippingPackageSize === "STANDARD" ||
      saved?.shippingPackageSize === "BULKY"
    ) {
      setShippingPackageSize(saved.shippingPackageSize)
    }
    if (saved?.weight != null) setWeightKg(saved.weight)
    if (saved?.status) setStatus(saved.status as ProductStatus)
    if (!saved) {
      void clearDraftPhotos()
    }
    setDraftReady(true)
  }

  useEffect(() => {
    if (!isNew || restoreDraft) return
    void clearAllDraftData()
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
      weight: weightKg,
      shippingPackageSize: shippingPackageSize,
      widthCm: current?.widthCm ?? "",
      lengthCm: current?.lengthCm ?? "",
      heightCm: current?.heightCm ?? "",
      categoryId,
      condition,
      status,
      brand: current?.brand ?? "",
    })
  }, [categoryId, condition, draftReady, isNew, restoreDraft, shippingPackageSize, status, weightKg])

  return {
    isNew,
    isSubmittingRef,
    formRef,
    resetKey,
    pendingFilesRef,
    draft,
    draftReady,
    categoryId,
    setCategoryId,
    condition,
    setCondition,
    shippingPackageSize,
    setShippingPackageSize,
    weightKg,
    setWeightKg,
    status,
    setStatus,
    resetFormState,
  }
}

function useProductFormPersist({
  isNew,
  restoreDraft,
  isSubmittingRef,
  pendingFilesRef,
  shippingPackageSize,
  categoryId,
  condition,
  status,
}: {
  isNew: boolean
  restoreDraft: boolean
  isSubmittingRef: { current: boolean }
  pendingFilesRef: { current: File[] }
  shippingPackageSize: ShippingPackageSize
  categoryId: string
  condition: ProductCondition
  status: ProductStatus
}) {
  function persistFromForm(form: HTMLFormElement) {
    if (!isNew || !restoreDraft || isSubmittingRef.current) return
    const formData = new FormData(form)
    saveDraftFields({
      title: String(formData.get("title") ?? ""),
      sku: String(formData.get("sku") ?? ""),
      description: String(formData.get("description") ?? ""),
      price: String(formData.get("price") ?? ""),
      weight: String(formData.get("weight") ?? ""),
      shippingPackageSize,
      widthCm: String(formData.get("widthCm") ?? ""),
      lengthCm: String(formData.get("lengthCm") ?? ""),
      heightCm: String(formData.get("heightCm") ?? ""),
      categoryId,
      condition,
      status,
      brand: String(formData.get("brand") ?? ""),
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
            shippingPackageSize,
            widthCm: "",
            lengthCm: "",
            heightCm: "",
            categoryId,
            condition,
            status,
          }
          saveDraftFields(current)
        }
      }
    },
    [
      categoryId,
      condition,
      isNew,
      isSubmittingRef,
      pendingFilesRef,
      restoreDraft,
      shippingPackageSize,
      status,
    ],
  )

  return { persistFromForm, handlePendingFilesChange }
}

function useProductFormSubmitAction({
  action,
  isNew,
  restoreDraft,
  isSubmittingRef,
  pendingFilesRef,
  resetFormState,
}: {
  action: ProductFormAction
  isNew: boolean
  restoreDraft: boolean
  isSubmittingRef: { current: boolean }
  pendingFilesRef: { current: File[] }
  resetFormState: () => void
}) {
  return useCallback(
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
    [action, isNew, isSubmittingRef, pendingFilesRef, resetFormState, restoreDraft],
  )
}

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
  action: ProductFormAction
  submitLabel: string
  restoreDraft?: boolean
}) {
  const {
    isNew,
    isSubmittingRef,
    formRef,
    resetKey,
    pendingFilesRef,
    draft,
    draftReady,
    categoryId,
    setCategoryId,
    condition,
    setCondition,
    shippingPackageSize,
    setShippingPackageSize,
    weightKg,
    setWeightKg,
    status,
    setStatus,
    resetFormState,
  } = useProductFormDraft(product, restoreDraft)
  const { persistFromForm, handlePendingFilesChange } = useProductFormPersist({
    isNew,
    restoreDraft,
    isSubmittingRef,
    pendingFilesRef,
    shippingPackageSize,
    categoryId,
    condition,
    status,
  })

  const submitAction = useProductFormSubmitAction({
    action,
    isNew,
    restoreDraft,
    isSubmittingRef,
    pendingFilesRef,
    resetFormState,
  })
  const [state, formAction, pending] = useActionState(submitAction, {})
  const [isPending, startTransition] = useTransition()

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
    submitProductForm(event, {
      isSubmittingRef,
      restoreDraft,
      persistFromForm,
      pendingFilesRef,
      startTransition,
      formAction,
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
      <ProductFormPhotos
        resetKey={resetKey}
        product={product}
        restoreDraft={restoreDraft}
        draft={draft}
        handlePendingFilesChange={handlePendingFilesChange}
        imagesError={state.fieldErrors?.images}
      />

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
        <ProductFormFields
          product={product}
          draft={draft}
          state={state}
          shippingPackageSize={shippingPackageSize}
          setShippingPackageSize={setShippingPackageSize}
          weightKg={weightKg}
          setWeightKg={setWeightKg}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          categories={categories}
          initialRoots={initialRoots}
          condition={condition}
          setCondition={setCondition}
          status={status}
          setStatus={setStatus}
        />
        <ProductFormSubmit saving={saving} submitLabel={submitLabel} />
      </div>
    </form>
  )
}
