"use client"

import { useEffect, useRef, useState } from "react"

import {
  deleteProductImageAction,
  reorderProductImagesAction,
  uploadProductImages,
} from "@/app/actions/uploads"
import type { InventoryProductImage } from "@/lib/inventory/types"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { loadDraftPhotos } from "@/lib/product-form/draft"
import { compressImageFiles } from "@/lib/images/compress"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"

import {
  finishPhotoSlotDrag,
  movePhotoSlotDrag,
  startPhotoSlotDrag,
  type DragSession,
  type PhotoSlotDragRefs,
} from "./photo-slots-drag"
import { PhotoSlotsGrid } from "./photo-slots-grid"

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]

type SlotImage = {
  url: string
  id?: string
  file?: File
}

function mapProductImages(productImages: InventoryProductImage[]): SlotImage[] {
  return productImages
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => ({ url: image.url, id: image.id }))
}

function roomForPhotos(safeImages: SlotImage[], atIndex?: number) {
  const replacing =
    typeof atIndex === "number" && atIndex >= 0 && atIndex < safeImages.length
  return replacing
    ? PRODUCT_IMAGE_MAX - safeImages.length + 1
    : PRODUCT_IMAGE_MAX - safeImages.length
}

async function persistPhotoSlotOrder(
  productId: string | undefined,
  next: SlotImage[],
  setError: (error: string | null) => void,
) {
  if (!productId) return
  const ids = next.map((slot) => slot.id).filter(Boolean) as string[]
  if (ids.length !== next.length) return
  try {
    const result = await reorderProductImagesAction(productId, ids)
    if (result.error) setError(result.error)
  } catch (error) {
    if (isNextRedirect(error)) throw error
    setError(actionFailureMessage(error))
  }
}

async function addPhotoSlotFiles(ctx: {
  fileList: FileList | null
  atIndex?: number
  uploading: boolean
  productId?: string
  safeImages: SlotImage[]
  setUploading: (value: boolean) => void
  setError: (error: string | null) => void
  commit: (next: SlotImage[]) => void
}) {
  if (!ctx.fileList?.length || ctx.uploading) return
  const incoming = Array.from(ctx.fileList)
  const valid = incoming.filter(
    (file) =>
      ACCEPTED_TYPES.includes(file.type?.toLowerCase()) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name),
  )
  const rejectedType = incoming.length - valid.length
  if (valid.length === 0) {
    ctx.setError("Usa fotos en formato JPEG, PNG, WebP o HEIC.")
    return
  }

  const room = roomForPhotos(ctx.safeImages, ctx.atIndex)
  if (room <= 0) {
    ctx.setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)
    return
  }

  const accepted = valid.slice(0, room)
  const skipped = valid.length - accepted.length

  ctx.setUploading(true)
  ctx.setError(null)
  let compressed: File[]
  try {
    compressed = await compressImageFiles(accepted)
  } catch (err) {
    ctx.setUploading(false)
    const message =
      err instanceof Error ? err.message : "No se pudieron procesar las fotos."
    ctx.setError(message)
    return
  }

  if (ctx.productId) {
    const formData = new FormData()
    compressed.forEach((file) => formData.append("files", file))
    try {
      const result = await uploadProductImages(formData, ctx.productId)
      if (result.error || result.urls.length === 0) {
        ctx.setError(result.error ?? "No se pudo guardar la imagen.")
        return
      }
      const uploaded = result.urls.map((url, index) => ({
        url,
        id: result.imageIds?.[index],
      }))
      const next = [...ctx.safeImages]
      if (
        typeof ctx.atIndex === "number" &&
        ctx.atIndex >= 0 &&
        ctx.atIndex < next.length
      ) {
        next.splice(ctx.atIndex, 1, ...uploaded)
      } else {
        next.push(...uploaded)
      }
      ctx.commit(next.slice(0, PRODUCT_IMAGE_MAX))
    } catch (error) {
      if (isNextRedirect(error)) throw error
      ctx.setError(actionFailureMessage(error))
      return
    } finally {
      ctx.setUploading(false)
    }
  } else {
    const added: SlotImage[] = compressed.map((file) => ({
      url: URL.createObjectURL(file),
      file,
    }))
    const next = [...ctx.safeImages]
    if (
      typeof ctx.atIndex === "number" &&
      ctx.atIndex >= 0 &&
      ctx.atIndex < next.length
    ) {
      const old = next[ctx.atIndex]
      if (old?.url.startsWith("blob:")) URL.revokeObjectURL(old.url)
      next.splice(ctx.atIndex, 1, ...added)
    } else {
      next.push(...added)
    }
    ctx.commit(next.slice(0, PRODUCT_IMAGE_MAX))
    ctx.setUploading(false)
  }

  const notes: string[] = []
  if (skipped > 0) {
    notes.push(
      `Máximo ${PRODUCT_IMAGE_MAX} fotos. No se añadieron los archivos extra.`,
    )
  }
  if (rejectedType > 0) {
    notes.push("Algunos archivos se omitieron. Usa JPEG, PNG o WebP.")
  }
  if (notes.length > 0) ctx.setError(notes.join(" "))
}

async function removePhotoSlot(ctx: {
  index: number
  productId?: string
  safeImages: SlotImage[]
  setUploading: (value: boolean) => void
  setError: (error: string | null) => void
  commit: (next: SlotImage[]) => void
}) {
  const target = ctx.safeImages[ctx.index]
  if (!target) return
  if (ctx.productId && target.id) {
    ctx.setUploading(true)
    try {
      const result = await deleteProductImageAction(ctx.productId, target.id)
      if (result.error) {
        ctx.setError(result.error)
        return
      }
    } catch (error) {
      if (isNextRedirect(error)) throw error
      ctx.setError(actionFailureMessage(error))
      return
    } finally {
      ctx.setUploading(false)
    }
  }
  if (target.url.startsWith("blob:")) URL.revokeObjectURL(target.url)
  const next = ctx.safeImages.filter((_, itemIndex) => itemIndex !== ctx.index)
  ctx.commit(next)
  if (ctx.productId) await persistPhotoSlotOrder(ctx.productId, next, ctx.setError)
}

function subscribeDraftPhotoSlots(
  productId: string | undefined,
  restoreDraft: boolean,
  setSlots: (slots: SlotImage[]) => void,
) {
  if (productId || !restoreDraft) return
  let cancelled = false
  void loadDraftPhotos().then(async (files) => {
    if (cancelled || files.length === 0) return
    const compressed = await compressImageFiles(files.slice(0, PRODUCT_IMAGE_MAX))
    if (cancelled) return
    setSlots(compressed.map((file) => ({ url: URL.createObjectURL(file), file })))
  })
  return () => {
    cancelled = true
  }
}

export type PhotoSlotsProps = {
  productId?: string
  productImages?: InventoryProductImage[]
  restoreDraft?: boolean
  onPendingFilesChange?: (files: File[]) => void
}

export function PhotoSlots({
  productId,
  productImages = [],
  restoreDraft = false,
  onPendingFilesChange,
}: PhotoSlotsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const overIndexRef = useRef<number | null>(null)
  const replaceIndexRef = useRef<number | undefined>(undefined)
  const [slots, setSlots] = useState<SlotImage[]>(() =>
    mapProductImages(productImages),
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRefs: PhotoSlotDragRefs = { sessionRef, overIndexRef, gridRef }

  useEffect(() => {
    if (productId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync slot state when server updates product images
      setSlots(mapProductImages(productImages))
    }
  }, [productId, productImages])

  useEffect(
    () => subscribeDraftPhotoSlots(productId, restoreDraft, setSlots),
    [productId, restoreDraft],
  )

  const onPendingFilesChangeRef = useRef(onPendingFilesChange)
  useEffect(() => {
    onPendingFilesChangeRef.current = onPendingFilesChange
  })

  useEffect(() => {
    if (productId) return
    onPendingFilesChangeRef.current?.(
      slots.map((slot) => slot.file).filter(Boolean) as File[],
    )
  }, [slots, productId])

  useEffect(() => {
    if (dragIndex === null) return
    const blockScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
    }
    document.addEventListener("touchmove", blockScroll, { passive: false })
    return () => document.removeEventListener("touchmove", blockScroll)
  }, [dragIndex])

  const safeImages = slots
  const gridSlots = Array.from(
    { length: PRODUCT_IMAGE_MAX },
    (_, index) => safeImages[index] ?? null,
  )
  function commit(next: SlotImage[]) {
    setSlots(next.slice(0, PRODUCT_IMAGE_MAX))
  }

  return (
    <PhotoSlotsGrid
      inputRef={inputRef}
      gridRef={gridRef}
      replaceIndexRef={replaceIndexRef}
      gridSlots={gridSlots}
      imageCount={safeImages.length}
      productId={productId}
      dragIndex={dragIndex}
      overIndex={overIndex}
      uploading={uploading}
      error={error}
      onAddFiles={(fileList, atIndex) =>
        void addPhotoSlotFiles({
          fileList,
          atIndex,
          uploading,
          productId,
          safeImages,
          setUploading,
          setError,
          commit,
        })
      }
      onRemove={(index) =>
        void removePhotoSlot({
          index,
          productId,
          safeImages,
          setUploading,
          setError,
          commit,
        })
      }
      onClearAll={() => {
        safeImages.forEach((s) => {
          if (s.url.startsWith("blob:")) URL.revokeObjectURL(s.url)
        })
        setSlots([])
        setError(null)
      }}
      onOpenPicker={() => {
        replaceIndexRef.current = undefined
        inputRef.current?.click()
      }}
      onMaxReached={() => setError(`Máximo ${PRODUCT_IMAGE_MAX} fotos.`)}
      onPointerDown={(event, index) =>
        startPhotoSlotDrag(event, index, uploading, sessionRef)
      }
      onPointerMove={(event) =>
        movePhotoSlotDrag(event, dragRefs, setDragIndex, setOverIndex)
      }
      onPointerUp={(event) =>
        finishPhotoSlotDrag(event, {
          ...dragRefs,
          safeImages,
          setDragIndex,
          setOverIndex,
          commit,
          persistOrder: (next) =>
            void persistPhotoSlotOrder(productId, next, setError),
        })
      }
    />
  )
}
